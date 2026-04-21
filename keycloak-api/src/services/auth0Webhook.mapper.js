export function mapWebhookToProfile(body) {
  if (!body || typeof body !== "object") return null;
  const email =
    body.email ||
    body.user?.email ||
    body.user?.user_metadata?.email ||
    "";
  const sub =
    body.user_id ||
    body.user?.user_id ||
    body.sub ||
    body.user?.sub ||
    "";
  if (!email && !sub) return null;
  return {
    sub: sub || `email|${email}`,
    email,
    name: body.user?.name || body.name || "",
    email_verified:
      body.user?.email_verified ?? body.email_verified ?? false,
  };
}
