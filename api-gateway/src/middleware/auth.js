import * as jose from "jose";

function normalizeAuth0Domain(d) {
  return (d || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function issuerHostname(iss) {
  try {
    return new URL(iss).hostname;
  } catch {
    return "";
  }
}

/**
 * Auth0 access tokens may use a custom login domain (iss host ≠ *.auth0.com).
 * Match keycloak-api behavior: AUTH0_ISSUER and/or AUTH0_DOMAIN.
 */
function isAuth0AccessTokenIssuer(iss) {
  if (!iss || typeof iss !== "string") return false;
  if (iss.includes("auth0.com")) return true;
  const configuredIssuer = (process.env.AUTH0_ISSUER || "").trim().replace(/\/$/, "");
  if (configuredIssuer) {
    const tokenIss = iss.trim().replace(/\/$/, "");
    if (tokenIss === configuredIssuer) return true;
  }
  const domain = normalizeAuth0Domain(process.env.AUTH0_DOMAIN || "");
  if (domain && issuerHostname(iss) === domain) return true;
  return false;
}

function auth0JwksUrlForIssuer(iss) {
  return `${new URL(iss).origin}/.well-known/jwks.json`;
}

const jwksCache = new Map();

function remoteJwks(url) {
  if (!jwksCache.has(url)) {
    jwksCache.set(url, jose.createRemoteJWKSet(new URL(url)));
  }
  return jwksCache.get(url);
}

/** jose only accepts compact JWS (header.payload.sig). Opaque OAuth tokens fail here. */
function normalizeAndAssertJwtAccessToken(raw) {
  if (raw == null || typeof raw !== "string") {
    const e = new Error("missing_token_string");
    e.code = "ERR_JWT_INVALID";
    throw e;
  }
  let t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  const parts = t.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    const e = new Error(
      "not_compact_jwt: access token must be a JWT (three base64url segments). Keycloak may be issuing an opaque token for this client — enable JWT access tokens / use a different client."
    );
    e.code = "ERR_JWT_INVALID";
    throw e;
  }
  return t;
}

/** Keycloak access tokens have iss like http(s)://host/realms/{realm} — use realm from token for JWKS. */
function keycloakJwksUrl(iss) {
  const override = (process.env.KEYCLOAK_JWKS_URI || "").trim();
  if (override) return override;
  const internal = (process.env.KEYCLOAK_INTERNAL_BASE_URL || "http://keycloak:8080").replace(
    /\/$/,
    ""
  );
  const m = String(iss).match(/\/realms\/([^/]+)/);
  const realm = m ? m[1] : "master";
  return `${internal}/realms/${realm}/protocol/openid-connect/certs`;
}

export async function verifyBearerToken(token) {
  const compact = normalizeAndAssertJwtAccessToken(token);
  const decoded = jose.decodeJwt(compact);
  const iss = decoded.iss;
  if (!iss) {
    throw new Error("missing iss");
  }

  let jwksUrl;
  let audience;

  const isKeycloakRealm = /\/realms\//.test(iss);

  if (isKeycloakRealm) {
    jwksUrl = keycloakJwksUrl(iss);
    const aud = (process.env.KEYCLOAK_AUDIENCE || "").trim();
    audience = aud || undefined;
  } else if (isAuth0AccessTokenIssuer(iss)) {
    jwksUrl = auth0JwksUrlForIssuer(iss);
    // Only verify `aud` when an API audience is explicitly configured. Using
    // AUTH0_CLIENT_ID as default breaks ROPG / many access tokens whose `aud`
    // is not the SPA client id.
    const aud = (process.env.AUTH0_AUDIENCE || "").trim();
    audience = aud || undefined;
  } else {
    const kcJwks = (process.env.KEYCLOAK_JWKS_URI || "").trim();
    if (!kcJwks) {
      throw new Error(
        "issuer_not_recognized: expected Keycloak (/realms/ in iss), Auth0 (set AUTH0_DOMAIN to match jwt iss host, or AUTH0_ISSUER), or set KEYCLOAK_JWKS_URI"
      );
    }
    jwksUrl = kcJwks;
    const aud = (process.env.KEYCLOAK_AUDIENCE || "").trim();
    audience = aud || undefined;
  }

  const jwks = remoteJwks(jwksUrl);
  const verifyOpts = { issuer: iss };
  if (audience) verifyOpts.audience = audience;
  const { payload } = await jose.jwtVerify(compact, jwks, verifyOpts);
  return payload;
}

const AUTHZ_BASE_URL = process.env.AUTHZ_BASE_URL || "http://localhost:4001";

/** Auth0 access tokens from Universal Login often omit `email`; UserInfo has it. */
async function fetchAuth0EmailFromUserinfo(accessToken, iss) {
  if (!accessToken || !iss) return null;
  let url;
  try {
    url = `${new URL(iss).origin}/userinfo`;
  } catch {
    const d = normalizeAuth0Domain(process.env.AUTH0_DOMAIN || "");
    if (!d) return null;
    url = `https://${d}/userinfo`;
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json();
    if (info?.email) return String(info.email).trim().toLowerCase();
    return null;
  } catch (e) {
    console.warn("[tl:gateway] auth0 userinfo for ensure", e.message);
    return null;
  }
}

async function resolveInternalUserId(payload) {
  const issuer = payload.iss;
  const subject = payload.sub;
  if (!issuer || !subject) return null;
  try {
    const url = `${AUTHZ_BASE_URL}/authz/resolve?issuer=${encodeURIComponent(issuer)}&subject=${encodeURIComponent(subject)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data.userId || null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ userId: string | null, email?: string }}
 */
async function ensureIdentityFromToken(payload, accessToken) {
  const issuer = payload.iss;
  const subject = payload.sub;
  let email =
    typeof payload.email === "string"
      ? payload.email.trim().toLowerCase()
      : typeof payload.preferred_username === "string" &&
          payload.preferred_username.includes("@")
        ? payload.preferred_username.trim().toLowerCase()
        : null;

  if (!email && accessToken && issuer && isAuth0AccessTokenIssuer(issuer)) {
    const fromUserinfo = await fetchAuth0EmailFromUserinfo(accessToken, issuer);
    if (fromUserinfo) email = fromUserinfo;
  }

  if (!issuer || !subject || !email) {
    return { userId: null };
  }
  try {
    const r = await fetch(`${AUTHZ_BASE_URL}/authz/identities/ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuer, subject, email }),
    });
    if (!r.ok) return { userId: null };
    const data = await r.json();
    return { userId: data.userId || null, email };
  } catch {
    return { userId: null };
  }
}

export async function authenticateJwt(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  if (!m) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }
  try {
    const payload = await verifyBearerToken(m[1]);
    req.jwtPayload = payload;
    let userId = await resolveInternalUserId(payload);
    let ensuredEmail;
    if (!userId) {
      const ensured = await ensureIdentityFromToken(payload, m[1]);
      userId = ensured.userId;
      ensuredEmail = ensured.email;
    }
    if (!userId) {
      userId = payload.sub;
    }
    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.preferred_username === "string" &&
            payload.preferred_username.includes("@")
          ? payload.preferred_username
          : ensuredEmail;
    req.user = {
      sub: payload.sub,
      email,
      userId,
      iss: payload.iss,
    };
    return next();
  } catch (e) {
    const code = e.code || e.name || "verify_error";
    console.error("jwt verify failed", code, e.message);
    let hint;
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && /aud/i.test(String(e.message))) {
      hint =
        "audience_mismatch: leave AUTH0_AUDIENCE and KEYCLOAK_AUDIENCE unset unless they match the access token aud claim.";
    } else if (/not_compact_jwt/i.test(String(e.message))) {
      hint =
        "Stored token is not a JWT (not three dot-separated segments). Auth0 usually returns opaque access tokens unless you pass an API audience (set AUTH0_AUDIENCE on login and on /callback token exchange). Keycloak: use a client that issues JWT access tokens.";
    } else if (code === "ERR_JWT_INVALID" || /compact jws/i.test(String(e.message))) {
      hint =
        "JWT validation failed. Clear localStorage access_token if stale; verify issuer/audience and signing keys.";
    } else if (/issuer_not_recognized/i.test(String(e.message))) {
      hint =
        "Auth0 custom domain: set AUTH0_DOMAIN to the same host as the token iss (or set AUTH0_ISSUER to the full issuer URL).";
    }
    return res.status(401).json({
      error: "invalid_token",
      ...(hint && { hint }),
      ...(process.env.NODE_ENV !== "production" && { debug: e.message }),
    });
  }
}
