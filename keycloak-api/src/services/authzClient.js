const AUTHZ_BASE = process.env.AUTHZ_BASE_URL;

export async function resolveAuthzIdentity({ issuer, subject }) {
  if (!AUTHZ_BASE || !issuer || !subject) return null;
  try {
    const url = `${AUTHZ_BASE}/authz/resolve?issuer=${encodeURIComponent(
      issuer
    )}&subject=${encodeURIComponent(subject)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data.userId || null;
  } catch (e) {
    console.error("authz resolve", e);
    return null;
  }
}

/** Used to validate Keycloak `app_user_id` before linking JWT `sub` to an internal user. */
export async function getAuthzUserEmail(userId) {
  if (!AUTHZ_BASE || !userId) return null;
  try {
    const r = await fetch(
      `${AUTHZ_BASE}/authz/me/${encodeURIComponent(userId)}`
    );
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.email === "string" ? data.email.toLowerCase() : null;
  } catch (e) {
    console.error("authz me email", e);
    return null;
  }
}

export async function ensureAuthzIdentity({ issuer, subject, email }) {
  if (!AUTHZ_BASE || !issuer || !subject || !email) return null;
  try {
    const r = await fetch(`${AUTHZ_BASE}/authz/identities/ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuer,
        subject,
        email: String(email).toLowerCase(),
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.userId || null;
  } catch (e) {
    console.error("authz ensure", e);
    return null;
  }
}

export async function linkAuthzIdentity({ userId, issuer, subject }) {
  if (!AUTHZ_BASE || !userId || !issuer || !subject) return;
  try {
    await fetch(`${AUTHZ_BASE}/authz/identities/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, issuer, subject }),
    });
  } catch (e) {
    console.error("authz link", e);
  }
}
