/**
 * Creates a super-admin user in Keycloak and the authz MySQL database.
 *
 * Prerequisites: authz schema bootstrapped (see src/db/init.js), Keycloak reachable.
 *
 * Role: ADMIN (includes MANAGE_USER_ROLES; see authz-service/src/db/init.js).
 *
 * Usage (from repo root or authz-service):
 *   cd authz-service && SUPER_ADMIN_EMAIL=admin@corp.com SUPER_ADMIN_PASSWORD='...' node scripts/create-super-admin.mjs
 *
 * Env (Keycloak — same as keycloak-api):
 *   KEYCLOAK_BASE_URL or KEYCLOAK_URL
 *   KEYCLOAK_REALM (default: master)
 *   KEYCLOAK_USE_CLIENT_CREDENTIALS=true → KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET
 *   else → KC_ADMIN_CLIENT_ID (default admin-cli), KC_ADMIN_USERNAME, KC_ADMIN_PASSWORD
 *
 * MySQL (authz):
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 * Optional:
 *   SUPER_ADMIN_INTERNAL_ID — fixed UUID for users.id (default: random)
 *   SUPER_ADMIN_PASSWORD — required if the Keycloak user is created here
 *   RESET_EXISTING_PASSWORD=true — if user exists in Keycloak, set password (optional)
 */

import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotenvUpwards() {
  const candidates = [
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../.env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}

loadDotenvUpwards();

function baseUrl() {
  const u = process.env.KEYCLOAK_BASE_URL || process.env.KEYCLOAK_URL;
  if (!u) throw new Error("Missing KEYCLOAK_BASE_URL or KEYCLOAK_URL");
  return u.replace(/\/$/, "");
}

function realm() {
  return process.env.KEYCLOAK_REALM || "master";
}

function realmIssuer() {
  return `${baseUrl()}/realms/${realm()}`;
}

let cachedToken = { token: null, exp: 0 };

async function getAdminAccessToken() {
  const now = Date.now() / 1000;
  if (cachedToken.token && cachedToken.exp > now + 30) {
    return cachedToken.token;
  }

  const tokenUrl = `${baseUrl()}/realms/${realm()}/protocol/openid-connect/token`;

  if (process.env.KEYCLOAK_USE_CLIENT_CREDENTIALS === "true") {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
    });
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || "kc_admin_token_failed");
    cachedToken = {
      token: data.access_token,
      exp: now + (data.expires_in || 60),
    };
    return cachedToken.token;
  }

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: process.env.KC_ADMIN_CLIENT_ID || "admin-cli",
    username: process.env.KC_ADMIN_USERNAME || "admin",
    password: process.env.KC_ADMIN_PASSWORD || "admin",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "kc_admin_token_failed");
  }
  cachedToken = {
    token: data.access_token,
    exp: now + (data.expires_in || 60),
  };
  return cachedToken.token;
}

async function kcFetch(path, options = {}) {
  const token = await getAdminAccessToken();
  const url = `${baseUrl()}/admin/realms/${realm()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

async function findUsersByEmail(email) {
  const res = await kcFetch(
    `/users?email=${encodeURIComponent(email)}&exact=true`
  );
  if (!res.ok) return [];
  return res.json();
}

async function createKeycloakUser(payload) {
  const res = await kcFetch("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.status === 201 || res.status === 204) {
    const loc = res.headers.get("Location") || "";
    const idFromLoc = loc.includes("/") ? loc.split("/").pop() : null;
    return { created: true, id: idFromLoc || null };
  }
  const errText = await res.text();
  let err;
  try {
    err = JSON.parse(errText);
  } catch {
    err = { message: errText };
  }
  throw new Error(err.errorMessage || err.message || "create_user_failed");
}

async function getUserById(id) {
  const res = await kcFetch(`/users/${id}`);
  if (!res.ok) return null;
  return res.json();
}

async function updateKeycloakUser(id, payload) {
  const res = await kcFetch(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (res.status === 204) return { updated: true };
  const errText = await res.text();
  throw new Error(errText || "update_user_failed");
}

async function resetUserPassword(userId, password, temporary = false) {
  const res = await kcFetch(`/users/${userId}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({
      type: "password",
      value: password,
      temporary,
    }),
  });
  if (res.status === 204) return true;
  const errText = await res.text();
  throw new Error(errText || "reset_password_failed");
}

function deriveUsername(email) {
  if (email && email.includes("@")) return email.split("@")[0] || `admin_${Date.now()}`;
  return `admin_${Date.now()}`;
}

async function main() {
  const emailArg = process.argv[2];
  const email = (
    process.env.SUPER_ADMIN_EMAIL ||
    emailArg ||
    ""
  ).trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error(
      "Usage: SUPER_ADMIN_EMAIL=user@example.com SUPER_ADMIN_PASSWORD=... node scripts/create-super-admin.mjs\n" +
        "   or: node scripts/create-super-admin.mjs user@example.com"
    );
    process.exit(1);
  }

  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  const internalId =
    process.env.SUPER_ADMIN_INTERNAL_ID || randomUUID();
  const issuer = realmIssuer();
  const resetExisting = process.env.RESET_EXISTING_PASSWORD === "true";

  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "authz",
    password: process.env.MYSQL_PASSWORD || "authz",
    database: process.env.MYSQL_DATABASE || "authz",
    waitForConnections: true,
    connectionLimit: 2,
  });

  let kcUserId;

  const existingKc = await findUsersByEmail(email);
  if (existingKc.length) {
    kcUserId = existingKc[0].id;
    console.log("Keycloak user already exists:", kcUserId);
    if (resetExisting && password) {
      await resetUserPassword(kcUserId, password, false);
      console.log("Password reset for existing Keycloak user.");
    } else if (!password) {
      console.log(
        "No SUPER_ADMIN_PASSWORD set; skipping Keycloak password (existing user)."
      );
    }
  } else {
    if (!password) {
      console.error(
        "SUPER_ADMIN_PASSWORD is required when creating a new Keycloak user."
      );
      process.exit(1);
    }
    const username = deriveUsername(email);
    const created = await createKeycloakUser({
      username,
      email,
      enabled: true,
      emailVerified: true,
      firstName: "Super",
      lastName: "Admin",
      attributes: { kc_password_enrolled: ["true"] },
    });
    kcUserId =
      created.id || (await findUsersByEmail(email))[0]?.id || null;
    if (!kcUserId) {
      throw new Error("keycloak_user_id_unresolved_after_create");
    }
    await resetUserPassword(kcUserId, password, false);
    console.log("Created Keycloak user:", kcUserId);
  }

  const [[adminRole]] = await pool.query(
    "SELECT id FROM roles WHERE name = ?",
    ["ADMIN"]
  );
  if (!adminRole) {
    throw new Error(
      "ADMIN role not found — run authz-service once so bootstrapSchema() seeds roles."
    );
  }

  const [byIdentity] = await pool.query(
    "SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?",
    [issuer, kcUserId]
  );

  let userId = byIdentity[0]?.user_id;

  if (userId) {
    await pool.query("UPDATE users SET email = ? WHERE id = ?", [email, userId]);
    console.log("Linked existing authz user by Keycloak identity:", userId);
  } else {
    const [byEmail] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (byEmail.length) {
      userId = byEmail[0].id;
      await pool.query(
        `INSERT IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)`,
        [issuer, kcUserId, userId]
      );
      console.log("Linked Keycloak identity to existing user row:", userId);
    } else {
      userId = internalId;
      await pool.query("INSERT INTO users (id, email) VALUES (?, ?)", [
        userId,
        email,
      ]);
      await pool.query(
        `INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)`,
        [issuer, kcUserId, userId]
      );
      console.log("Inserted authz user:", userId);
    }
  }

  await pool.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
    [userId, adminRole.id]
  );

  await pool.query(
    `DELETE ur FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = 'USER'`,
    [userId]
  );

  const ku = await getUserById(kcUserId);
  if (ku) {
    await updateKeycloakUser(kcUserId, {
      ...ku,
      attributes: {
        ...(ku.attributes || {}),
        app_user_id: [String(userId)],
        kc_password_enrolled: ["true"],
      },
    });
    console.log("Updated Keycloak app_user_id attribute.");
  }

  const [roles] = await pool.query(
    `SELECT r.name FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId]
  );

  console.log("Done. authz userId:", userId);
  console.log("Roles:", roles.map((r) => r.name).join(", "));
  console.log("JWT resolution: iss =", issuer, " sub =", kcUserId);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
