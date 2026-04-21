import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const PERMISSIONS = [
  { code: "VIEW_PORTAL", description: "Access Portal home" },
  { code: "VIEW_DASHBOARD", description: "View Dashboard" },
  { code: "VIEW_USERS", description: "View Users section" },
  { code: "CREATE_USER", description: "Create users" },
  {
    code: "MANAGE_USER_ROLES",
    description: "Assign or change roles for any user",
  },
];

const ROLES = [
  { name: "ADMIN", description: "Administrator" },
  { name: "USER", description: "Standard user" },
];

/** Maps each role name to permission codes (tabs and APIs use these). */
const ROLE_PERMISSION_CODES = {
  ADMIN: [
    "VIEW_PORTAL",
    "VIEW_DASHBOARD",
    "VIEW_USERS",
    "CREATE_USER",
    "MANAGE_USER_ROLES",
  ],
  USER: ["VIEW_PORTAL", "VIEW_DASHBOARD"],
};

export async function createPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
  });
}

export async function bootstrapSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      issuer VARCHAR(512) NOT NULL,
      subject VARCHAR(512) NOT NULL,
      user_id CHAR(36) NOT NULL,
      UNIQUE KEY uk_issuer_subject (issuer(255), subject(255)),
      INDEX idx_user_id (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      description VARCHAR(255)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      description VARCHAR(255)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id CHAR(36) NOT NULL,
      role_id INT NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INT NOT NULL,
      permission_id INT NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nav_menu_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sort_order INT NOT NULL DEFAULT 0,
      label VARCHAR(128) NOT NULL,
      path VARCHAR(255) NOT NULL,
      permission_code VARCHAR(64) NOT NULL,
      UNIQUE KEY uk_nav_path (path),
      CONSTRAINT fk_nav_menu_permission FOREIGN KEY (permission_code) REFERENCES permissions (code) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_feature_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sort_order INT NOT NULL DEFAULT 0,
      feature_group VARCHAR(64) NOT NULL,
      feature_name VARCHAR(64) NOT NULL,
      permission_code VARCHAR(64) NOT NULL,
      UNIQUE KEY uk_dash_feat (feature_group, feature_name),
      CONSTRAINT fk_dash_feat_permission FOREIGN KEY (permission_code) REFERENCES permissions (code) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  for (const p of PERMISSIONS) {
    await pool.query(
      "INSERT IGNORE INTO permissions (code, description) VALUES (?, ?)",
      [p.code, p.description]
    );
  }
  for (const r of ROLES) {
    await pool.query(
      "INSERT IGNORE INTO roles (name, description) VALUES (?, ?)",
      [r.name, r.description]
    );
  }

  const [permRowsAll] = await pool.query("SELECT id, code FROM permissions");
  const permByCode = Object.fromEntries(
    permRowsAll.map((row) => [row.code, row.id])
  );

  for (const [roleName, codes] of Object.entries(ROLE_PERMISSION_CODES)) {
    const [roleRows] = await pool.query(
      "SELECT id FROM roles WHERE name = ?",
      [roleName]
    );
    const roleRow = roleRows[0];
    if (!roleRow) continue;
    for (const code of codes) {
      const pid = permByCode[code];
      if (pid == null) continue;
      await pool.query(
        "INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [roleRow.id, pid]
      );
    }
  }

  await pool.query(`
    DELETE rp FROM role_permissions rp
    INNER JOIN permissions p ON p.id = rp.permission_id
    WHERE p.code = 'VIEW_USER'
  `);
  await pool.query("DELETE FROM permissions WHERE code = ?", ["VIEW_USER"]);

  await pool.query(`
    INSERT IGNORE INTO nav_menu_items (sort_order, label, path, permission_code) VALUES
    (0, 'Portal', '/portal', 'VIEW_PORTAL'),
    (1, 'Dashboard', '/dashboard', 'VIEW_DASHBOARD'),
    (2, 'Users', '/users', 'VIEW_USERS')
  `);
  await pool.query(`
    INSERT IGNORE INTO dashboard_feature_rules (sort_order, feature_group, feature_name, permission_code) VALUES
    (0, 'portal', 'view', 'VIEW_PORTAL'),
    (1, 'dashboard', 'view', 'VIEW_DASHBOARD'),
    (2, 'users', 'view', 'VIEW_USERS'),
    (3, 'users', 'create', 'CREATE_USER'),
    (4, 'users', 'manageRoles', 'MANAGE_USER_ROLES')
  `);

  const adminId =
    process.env.AUTHZ_ADMIN_INTERNAL_ID || "11111111-1111-1111-1111-111111111111";
  const adminAuth0Sub =
    process.env.AUTHZ_ADMIN_AUTH0_SUB || "auth0|demo-admin-sub";
  const adminEmail =
    process.env.AUTHZ_ADMIN_EMAIL || "admin@example.com";
  const auth0Issuer =
    process.env.AUTH0_ISSUER ||
    (process.env.AUTH0_DOMAIN
      ? `https://${String(process.env.AUTH0_DOMAIN).replace(/^https?:\/\//, "").replace(/\/$/, "")}/`
      : "https://placeholder.auth0.com/");

  await pool.query(
    "INSERT IGNORE INTO users (id, email) VALUES (?, ?)",
    [adminId, adminEmail]
  );
  await pool.query(
    `INSERT IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)`,
    [auth0Issuer, adminAuth0Sub, adminId]
  );
  await pool.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE name = 'ADMIN'`,
    [adminId]
  );

  const demoId =
    process.env.AUTHZ_DEMO_USER_INTERNAL_ID || "22222222-2222-2222-2222-222222222222";
  const demoAuth0Sub =
    process.env.AUTHZ_DEMO_USER_AUTH0_SUB || "auth0|demo-user-sub";
  const demoEmail = process.env.AUTHZ_DEMO_USER_EMAIL || "user@example.com";
  await pool.query(
    "INSERT IGNORE INTO users (id, email) VALUES (?, ?)",
    [demoId, demoEmail]
  );
  await pool.query(
    `INSERT IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)`,
    [auth0Issuer, demoAuth0Sub, demoId]
  );
  await pool.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE name = 'USER'`,
    [demoId]
  );
}

export function newInternalId() {
  return randomUUID();
}
