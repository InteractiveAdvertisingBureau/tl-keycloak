const realm = () => process.env.KEYCLOAK_REALM || "master";

/** Log once at startup: URLs, realm, client IDs, scopes; secrets redacted. */
export function logKeycloakStartupConfig() {
  const mask = (v) =>
    v == null || String(v).trim() === "" ? "(unset)" : "***redacted***";
  let resolvedBase;
  try {
    resolvedBase = baseUrl();
  } catch (e) {
    resolvedBase = `(error: ${e.message})`;
  }
  let issuer;
  try {
    issuer = keycloakRealmIssuer();
  } catch {
    issuer = "(unavailable)";
  }
  const useCc = process.env.KEYCLOAK_USE_CLIENT_CREDENTIALS === "true";
  const cfg = {
    KEYCLOAK_REALM: process.env.KEYCLOAK_REALM || "master (default)",
    resolvedBaseUrl: resolvedBase,
    KEYCLOAK_BASE_URL: process.env.KEYCLOAK_BASE_URL || null,
    KEYCLOAK_URL: process.env.KEYCLOAK_URL || null,
    KEYCLOAK_USE_CLIENT_CREDENTIALS: useCc,
    adminTokenMode: useCc ? "client_credentials" : "password",
    KEYCLOAK_CLIENT_ID: useCc
      ? process.env.KEYCLOAK_CLIENT_ID || null
      : null,
    KEYCLOAK_CLIENT_SECRET: useCc ? mask(process.env.KEYCLOAK_CLIENT_SECRET) : null,
    KC_ADMIN_CLIENT_ID: !useCc
      ? process.env.KC_ADMIN_CLIENT_ID || "admin-cli (default)"
      : null,
    KC_ADMIN_USERNAME: !useCc
      ? process.env.KC_ADMIN_USERNAME || "admin (default)"
      : null,
    KC_ADMIN_PASSWORD: !useCc ? mask(process.env.KC_ADMIN_PASSWORD) : null,
    KEYCLOAK_ROPG_CLIENT_ID: process.env.KEYCLOAK_ROPG_CLIENT_ID || null,
    KEYCLOAK_ROPG_CLIENT_SECRET: mask(process.env.KEYCLOAK_ROPG_CLIENT_SECRET),
    KEYCLOAK_ROPG_SCOPE:
      process.env.KEYCLOAK_ROPG_SCOPE || "openid profile email (default)",
    realmIssuer: issuer,
    envKeysMatchingKeycloakOrKc: Object.keys(process.env)
      .filter((k) => /^KEYCLOAK/i.test(k) || /^KC_/i.test(k))
      .sort(),
  };
  console.log("[tl:keycloak-api] keycloak configuration", JSON.stringify(cfg, null, 2));
}

function baseUrl() {
  const u = process.env.KEYCLOAK_BASE_URL || process.env.KEYCLOAK_URL;
  if (!u) throw new Error("Missing KEYCLOAK_BASE_URL or KEYCLOAK_URL");
  return u.replace(/\/$/, "");
}

let cachedToken = { token: null, exp: 0 };

export async function getAdminAccessToken() {
  const now = Date.now() / 1000;
  if (cachedToken.token && cachedToken.exp > now + 30) {
    return cachedToken.token;
  }

  if (process.env.KEYCLOAK_USE_CLIENT_CREDENTIALS === "true") {
    const tokenUrl = `${baseUrl()}/realms/${realm()}/protocol/openid-connect/token`;
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

  const tokenUrl = `${baseUrl()}/realms/${realm()}/protocol/openid-connect/token`;
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

export async function findUsersByQuery(q) {
  const res = await kcFetch(`/users?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function findUsersByEmail(email) {
  const res = await kcFetch(
    `/users?email=${encodeURIComponent(email)}&exact=true`
  );
  if (!res.ok) return [];
  return res.json();
}

export function userMatchesAuth0Id(u, auth0Id) {
  const v = u?.attributes?.auth0_id;
  if (!auth0Id || !v) return false;
  if (Array.isArray(v)) {
    return v.includes(auth0Id) || v[0] === auth0Id;
  }
  return v === auth0Id;
}

/**
 * Keycloak Admin `q=` does not search custom attributes. Paginate `/users`
 * until we find `attributes.auth0_id` matching Auth0 `sub`.
 */
export async function findUserByAuth0Id(auth0Id) {
  if (!auth0Id) return null;
  const pageSize = Math.min(
    200,
    Math.max(50, Number(process.env.KEYCLOAK_USER_LIST_PAGE_SIZE) || 100)
  );
  for (let first = 0; ; first += pageSize) {
    const res = await kcFetch(
      `/users?first=${first}&max=${pageSize}&briefRepresentation=false`
    );
    if (!res.ok) return null;
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) return null;
    const hit = page.find((u) => userMatchesAuth0Id(u, auth0Id));
    if (hit) return hit;
    if (page.length < pageSize) return null;
  }
}

export async function createKeycloakUser(payload) {
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
  const e = new Error(err.errorMessage || err.message || "create_user_failed");
  if (res.status === 409) e.status = 409;
  throw e;
}

export async function updateKeycloakUser(id, payload) {
  const res = await kcFetch(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (res.status === 204) return { updated: true };
  const errText = await res.text();
  throw new Error(errText || "update_user_failed");
}

export async function getUserById(id) {
  const res = await kcFetch(`/users/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getUserCredentials(userId) {
  const res = await kcFetch(`/users/${userId}/credentials`);
  if (!res.ok) return [];
  return res.json();
}

export function hasPasswordCredential(credentials) {
  return (
    Array.isArray(credentials) &&
    credentials.some((c) => c.type === "password")
  );
}

export function isKcPasswordEnrolled(user) {
  const v = user?.attributes?.kc_password_enrolled;
  if (!v) return false;
  const s = Array.isArray(v) ? v[0] : v;
  return s === "true" || s === true;
}

export async function resetUserPassword(userId, password, temporary = false) {
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

export function keycloakRealmIssuer() {
  const b = baseUrl();
  return `${b}/realms/${realm()}`;
}

export async function findUserByUsernameExact(username) {
  const res = await kcFetch(
    `/users?username=${encodeURIComponent(username)}&exact=true`
  );
  if (!res.ok) return null;
  const arr = await res.json();
  return arr[0] || null;
}

export async function findUserForLoginIdentifier(identifier) {
  if (identifier.includes("@")) {
    const byEmail = await findUsersByEmail(identifier);
    if (byEmail.length) return byEmail[0];
  }
  return findUserByUsernameExact(identifier);
}

export async function shouldUseKeycloakLogin(user) {
  if (!user) return false;
  try {
    const creds = await getUserCredentials(user.id);
    return hasPasswordCredential(creds) || isKcPasswordEnrolled(user);
  } catch {
    return false;
  }
}

export async function loginWithResourceOwnerPassword(username, password) {
  const clientId = process.env.KEYCLOAK_ROPG_CLIENT_ID;
  if (!clientId) {
    const err = new Error("KEYCLOAK_ROPG_CLIENT_ID not configured");
    err.status = 501;
    throw err;
  }
  const tokenUrl = `${baseUrl()}/realms/${realm()}/protocol/openid-connect/token`;
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
  });
  if (process.env.KEYCLOAK_ROPG_CLIENT_SECRET) {
    params.set("client_secret", process.env.KEYCLOAK_ROPG_CLIENT_SECRET);
  }
  params.set(
    "scope",
    process.env.KEYCLOAK_ROPG_SCOPE || "openid profile email"
  );
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      data.error_description || data.error || "kc_login_failed"
    );
    err.status = 401;
    err.payload = data;
    throw err;
  }
  return data;
}
