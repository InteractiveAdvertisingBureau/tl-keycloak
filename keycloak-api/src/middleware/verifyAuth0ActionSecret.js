export function verifyAuth0ActionSecret(req, res, next) {
  const secret = process.env.AUTH0_ACTIONS_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "webhooks_not_configured" });
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
