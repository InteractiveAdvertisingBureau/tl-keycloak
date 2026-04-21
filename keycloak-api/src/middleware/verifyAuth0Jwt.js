import * as jose from "jose";

function normalizeDomain(d) {
  return (d || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function verifyAuth0Jwt(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }
  const domain = normalizeDomain(process.env.AUTH0_DOMAIN || "");
  if (!domain) {
    return res.status(503).json({ error: "auth0_not_configured" });
  }
  const issuer =
    process.env.AUTH0_ISSUER || `https://${domain}/`;
  const jwksUrl = `https://${domain}/.well-known/jwks.json`;
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
  const audience =
    process.env.AUTH0_AUDIENCE || process.env.AUTH0_CLIENT_ID || undefined;
  try {
    const verifyOpts = { issuer };
    if (audience) verifyOpts.audience = audience;
    const { payload } = await jose.jwtVerify(m[1], JWKS, verifyOpts);
    req.auth0Claims = payload;
    req.auth0BearerToken = m[1];
    next();
  } catch (e) {
    console.error("auth0 jwt", e.message);
    return res.status(401).json({ error: "invalid_token" });
  }
}
