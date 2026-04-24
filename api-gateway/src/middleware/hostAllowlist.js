/**
 * Optional public Host allowlist for production behind Cloudflare / a reverse proxy.
 * When non-empty, only matching hostnames may reach routes below the middleware.
 * Configure trust proxy when the TCP peer is not the client (see GATEWAY_TRUST_PROXY).
 */

export function parseAllowedHosts(envValue) {
  const raw = (envValue || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function hostAllowlistMiddleware(allowedHosts) {
  if (!allowedHosts.length) {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    const host = (req.hostname || "").toLowerCase();
    if (!host || !allowedHosts.includes(host)) {
      return res.status(403).json({
        error: "unknown_host",
        message: "Request Host is not allowed for this deployment.",
      });
    }
    next();
  };
}
