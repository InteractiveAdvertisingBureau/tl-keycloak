import { tlSpan } from "../lib/correlationLog.js";

function normalizeDomain(domain) {
  const d = (domain || "").trim();
  if (!d) throw new Error("Missing AUTH0_DOMAIN");
  return d.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function loginWithPassword({ username, password, correlationId }) {
  const domain = normalizeDomain(process.env.AUTH0_DOMAIN);
  const clientId = process.env.AUTH0_CLIENT_ID;
  const clientSecret = process.env.AUTH0_CLIENT_SECRET;
  const audience = process.env.AUTH0_AUDIENCE || "";
  const scope = process.env.AUTH0_SCOPE || "openid profile email";

  tlSpan("auth.provider", correlationId, "auth0_oauth_token_password_grant_request", {
    domain,
    grantHint: "password",
    usernameHint: typeof username === "string" ? username.includes("@") ? "email" : "opaque" : "none",
  });

  const params = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  if (audience) params.set("audience", audience);

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    tlSpan("auth.provider", correlationId, "auth0_oauth_token_error", {
      status: res.status,
      error: data?.error,
    });
    const err = new Error(data.error_description || data.error || "login_failed");
    err.status = res.status === 401 ? 401 : 400;
    err.payload = data;
    if (data.error === "invalid_grant") err.status = 401;
    throw err;
  }
  tlSpan("auth.provider", correlationId, "auth0_oauth_token_ok");
  return data;
}

export async function getUserInfo(accessToken) {
  const domain = normalizeDomain(process.env.AUTH0_DOMAIN);
  const res = await fetch(`https://${domain}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "userinfo_failed");
  }
  return res.json();
}
