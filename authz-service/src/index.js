import express from "express";
import cors from "cors";
import { createPool, bootstrapSchema, newInternalId } from "./db/init.js";

const PORT = Number(process.env.PORT || 4001);
const CACHE_TTL_MS = Number(process.env.AUTHZ_CACHE_TTL_MS || 60_000);

const permissionCache = new Map();

function cacheKey(userId) {
  return userId;
}

function getCached(userId) {
  const e = permissionCache.get(cacheKey(userId));
  if (!e) return null;
  if (Date.now() > e.expires) {
    permissionCache.delete(cacheKey(userId));
    return null;
  }
  return e.value;
}

function setCached(userId, value) {
  permissionCache.set(cacheKey(userId), {
    value,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

async function loadPermissions(pool, userId) {
  const cached = getCached(userId);
  if (cached) return cached;

  const [rows] = await pool.query(
    `SELECT DISTINCT p.code AS code
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = ?`,
    [userId]
  );
  const permissions = rows.map((r) => r.code);
  setCached(userId, permissions);
  return permissions;
}

async function loadRoles(pool, userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT r.name AS name
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id = ?`,
    [userId]
  );
  return rows.map((r) => r.name);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s);
}

async function listUsersWithRoles(pool) {
  const [users] = await pool.query(
    "SELECT id, email FROM users ORDER BY email ASC"
  );
  const [ur] = await pool.query(
    `SELECT ur.user_id AS userId, r.name AS roleName
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id`
  );
  const rolesByUser = new Map();
  for (const row of ur) {
    const list = rolesByUser.get(row.userId) || [];
    list.push(row.roleName);
    rolesByUser.set(row.userId, list);
  }
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    roles: rolesByUser.get(u.id) || [],
  }));
}

/**
 * Replaces all roles for a user. Ensures at least one ADMIN remains in the system.
 */
async function replaceUserRoles(pool, userId, roleNames) {
  const normalized = [
    ...new Set(
      roleNames.map((n) => String(n || "").trim().toUpperCase()).filter(Boolean)
    ),
  ];
  if (!normalized.length) {
    return { ok: false, error: "roles_required", status: 400 };
  }

  const placeholders = normalized.map(() => "?").join(",");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [roleRows] = await conn.query(
      `SELECT id, name FROM roles WHERE name IN (${placeholders})`,
      normalized
    );
    if (roleRows.length !== normalized.length) {
      await conn.rollback();
      return { ok: false, error: "invalid_roles", status: 400 };
    }
    const [users] = await conn.query("SELECT id FROM users WHERE id = ?", [
      userId,
    ]);
    if (!users.length) {
      await conn.rollback();
      return { ok: false, error: "user_not_found", status: 404 };
    }

    await conn.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
    for (const row of roleRows) {
      await conn.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
        [userId, row.id]
      );
    }

    const [adminCountRows] = await conn.query(
      `SELECT COUNT(DISTINCT ur.user_id) AS c
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'ADMIN'`
    );
    if (Number(adminCountRows[0]?.c) === 0) {
      await conn.rollback();
      return { ok: false, error: "last_admin", status: 400 };
    }

    await conn.commit();
    permissionCache.delete(userId);
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return { ok: false, error: "internal_error", status: 500 };
  } finally {
    conn.release();
  }
}

/**
 * Builds dashboard.menu and dashboard.features from DB-driven definitions
 * (nav_menu_items, dashboard_feature_rules) plus the user's permission codes.
 */
async function buildDashboardConfig(pool, permissionCodes) {
  const set = new Set(permissionCodes);
  const [menuRows] = await pool.query(
    `SELECT label, path, permission_code
     FROM nav_menu_items
     ORDER BY sort_order ASC, id ASC`
  );
  const menu = menuRows.map((row) => ({
    name: row.label,
    path: row.path,
    visible: set.has(row.permission_code),
  }));

  const [featRows] = await pool.query(
    `SELECT feature_group, feature_name, permission_code
     FROM dashboard_feature_rules
     ORDER BY sort_order ASC, id ASC`
  );
  const features = {};
  for (const row of featRows) {
    const g = row.feature_group;
    const n = row.feature_name;
    if (!features[g]) features[g] = {};
    features[g][n] = set.has(row.permission_code);
  }
  return { features, menu };
}

async function main() {
  const pool = await createPool({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "authz",
    password: process.env.MYSQL_PASSWORD || "authz",
    database: process.env.MYSQL_DATABASE || "authz",
  });

  await bootstrapSchema(pool);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/authz/resolve", async (req, res) => {
    const issuer = String(req.query.issuer || "");
    const subject = String(req.query.subject || "");
    if (!issuer || !subject) {
      return res.status(400).json({ error: "issuer_and_subject_required" });
    }
    try {
      const [rows] = await pool.query(
        "SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?",
        [issuer, subject]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.json({ userId: rows[0].user_id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.post("/authz/identities/ensure", async (req, res) => {
    const { issuer, subject, email } = req.body || {};
    if (!issuer || !subject || !email) {
      return res.status(400).json({ error: "issuer_subject_email_required" });
    }
    try {
      const normalizedEmail = String(email).toLowerCase();
      const [existing] = await pool.query(
        "SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?",
        [issuer, subject]
      );
      if (existing.length) {
        return res.json({ userId: existing[0].user_id, created: false });
      }
      const [byEmail] = await pool.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [normalizedEmail]
      );
      if (byEmail.length) {
        const userId = byEmail[0].id;
        await pool.query(
          "INSERT IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)",
          [issuer, subject, userId]
        );
        return res.json({ userId, created: false, linkedByEmail: true });
      }

      const id = newInternalId();
      await pool.query("INSERT INTO users (id, email) VALUES (?, ?)", [
        id,
        normalizedEmail,
      ]);
      await pool.query(
        "INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)",
        [issuer, subject, id]
      );
      await pool.query(
        `INSERT IGNORE INTO user_roles (user_id, role_id)
         SELECT ?, id FROM roles WHERE name = 'USER'`,
        [id]
      );
      permissionCache.delete(id);
      return res.json({ userId: id, created: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.post("/authz/identities/link", async (req, res) => {
    const { userId, issuer, subject } = req.body || {};
    if (!userId || !issuer || !subject) {
      return res
        .status(400)
        .json({ error: "userId_issuer_subject_required" });
    }
    try {
      const [u] = await pool.query("SELECT id FROM users WHERE id = ?", [
        userId,
      ]);
      if (!u.length) {
        return res.status(404).json({ error: "user_not_found" });
      }
      await pool.query(
        `INSERT IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)`,
        [issuer, subject, userId]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.post("/authz/check", async (req, res) => {
    const { userId, action } = req.body || {};
    if (!userId || !action) {
      return res.status(400).json({ error: "userId and action required" });
    }
    try {
      const permissions = await loadPermissions(pool, userId);
      const allowed =
        (action === "CREATE_USER" && permissions.includes("CREATE_USER")) ||
        (action === "VIEW_USERS" && permissions.includes("VIEW_USERS")) ||
        (action === "MANAGE_USER_ROLES" &&
          permissions.includes("MANAGE_USER_ROLES"));
      return res.json({ allowed });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/authz/roles/catalog", async (_req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT name, description FROM roles ORDER BY name ASC"
      );
      return res.json({ roles: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/authz/users", async (_req, res) => {
    try {
      const users = await listUsersWithRoles(pool);
      return res.json({ users });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.patch("/authz/users/:userId/roles", async (req, res) => {
    const { userId } = req.params;
    const { roles } = req.body || {};
    if (!isUuid(userId)) {
      return res.status(400).json({ error: "invalid_user_id" });
    }
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles_array_required" });
    }
    try {
      const result = await replaceUserRoles(pool, userId, roles);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      const names = await loadRoles(pool, userId);
      return res.json({ userId, roles: names });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/authz/permissions/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const permissions = await loadPermissions(pool, userId);
      return res.json({ permissions });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/authz/dashboard/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const [users] = await pool.query(
        "SELECT id FROM users WHERE id = ?",
        [userId]
      );
      if (users.length === 0) {
        return res.status(404).json({ error: "user_not_found" });
      }
      const permissions = await loadPermissions(pool, userId);
      const dashboard = await buildDashboardConfig(pool, permissions);
      return res.json(dashboard);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/authz/me/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const [users] = await pool.query(
        "SELECT id, email FROM users WHERE id = ?",
        [userId]
      );
      if (users.length === 0) {
        return res.status(404).json({ error: "user_not_found" });
      }
      const permissions = await loadPermissions(pool, userId);
      const roles = await loadRoles(pool, userId);
      const dashboard = await buildDashboardConfig(pool, permissions);
      return res.json({
        email: users[0].email,
        roles,
        permissions,
        dashboard,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.listen(PORT, () => {
    console.log(`authz-service listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
