import express from "express";
import { verifyAuth0ActionSecret } from "../middleware/verifyAuth0ActionSecret.js";
import { mapWebhookToProfile } from "../services/auth0Webhook.mapper.js";
import { syncUserToKeycloak } from "../services/userSync.service.js";

const router = express.Router();
router.use(verifyAuth0ActionSecret);

router.post("/pre-user-registration", (req, res) => {
  const email =
    req.body?.email ||
    req.body?.user?.email ||
    req.body?.user?.user_metadata?.email;
  if (!email) {
    return res.status(400).json({ ok: false, error: "email_required" });
  }
  return res.json({ ok: true });
});

router.post("/post-user-registration", async (req, res) => {
  const profile = mapWebhookToProfile(req.body);
  if (!profile) {
    return res.json({
      ok: true,
      keycloakSync: "skipped",
      reason: "invalid_payload",
    });
  }
  const result = await syncUserToKeycloak(profile);
  return res.json({ ok: true, ...result });
});

router.post("/post-login", async (req, res) => {
  const profile = mapWebhookToProfile(req.body);
  if (!profile) {
    return res.json({
      ok: true,
      keycloakSync: "skipped",
      reason: "invalid_payload",
    });
  }
  const result = await syncUserToKeycloak(profile);
  return res.json({ ok: true, ...result });
});

export default router;
