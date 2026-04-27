import express from "express";
import { verifyAuth0Jwt } from "../middleware/verifyAuth0Jwt.js";
import * as authProvider from "../services/auth.provider.js";
import {
  findUserByAuth0Id,
  findUsersByEmail,
  getUserCredentials,
  hasPasswordCredential,
  isKcPasswordEnrolled,
  resetUserPassword,
  updateKeycloakUser,
  userMatchesAuth0Id,
} from "../services/keycloak.service.js";

const router = express.Router();

/** Access tokens often omit `email`; UserInfo matches sync (userinfo has email). */
async function resolveEmailForLookup(req) {
  const claims = req.auth0Claims || {};
  let email =
    typeof claims.email === "string" ? claims.email.toLowerCase().trim() : "";
  if (email || !req.auth0BearerToken) return email;
  try {
    const info = await authProvider.getUserInfo(req.auth0BearerToken);
    if (info?.email) email = String(info.email).toLowerCase().trim();
  } catch (e) {
    console.warn("[tl:keycloak-api] kc-password userinfo email fallback", e.message);
  }
  return email;
}

async function findKeycloakUserForAuth0Request(req) {
  const claims = req.auth0Claims || {};
  const sub = claims.sub;
  const email = await resolveEmailForLookup(req);
  if (email) {
    const list = await findUsersByEmail(email);
    for (const u of list) {
      if (!sub || userMatchesAuth0Id(u, sub)) return u;
    }
    // Backward-compatible fallback for users synced/created without auth0_id.
    // If email lookup returns exactly one user, treat it as the target.
    if (list.length === 1) return list[0];
  }
  return sub ? await findUserByAuth0Id(sub) : null;
}

/** Lazy migration window: first status check while needsPassword sets this on the KC user. */
const KC_PASSWORD_DEADLINE_DAYS = 30;
const MS_PER_DAY = 86400000;

/** Whole UTC days from now until deadline instant; 0 if overdue. */
function deadlineFields(deadlineIso) {
  if (!deadlineIso) {
    return { deadlineIso: null, daysRemaining: null, deadlinePassed: false };
  }
  const end = new Date(deadlineIso).getTime();
  const diffMs = end - Date.now();
  const deadlinePassed = diffMs < 0;
  const daysRemaining = deadlinePassed
    ? 0
    : Math.max(0, Math.ceil(diffMs / MS_PER_DAY));
  return { deadlineIso, daysRemaining, deadlinePassed };
}

router.get("/kc-password-status", verifyAuth0Jwt, async (req, res) => {
  try {
    const kcUser = await findKeycloakUserForAuth0Request(req);
    if (!kcUser) {
      return res.json({
        needsPassword: true,
        keycloakUserId: null,
        keycloakUserMissing: true,
        deadlineIso: null,
        daysRemaining: null,
        deadlinePassed: false,
      });
    }
    const creds = await getUserCredentials(kcUser.id);
    const hasPw = hasPasswordCredential(creds);
    const enrolled = isKcPasswordEnrolled(kcUser);
    const needsPassword = !hasPw && !enrolled;
    if (!needsPassword) {
      return res.json({
        needsPassword: false,
        keycloakUserId: kcUser.id,
        keycloakUserMissing: false,
        deadlineIso: null,
        daysRemaining: null,
        deadlinePassed: false,
      });
    }

    const attrs = { ...(kcUser.attributes || {}) };
    let deadlineIso = attrs.kc_password_deadline?.[0] || null;
    if (!deadlineIso) {
      const deadline = new Date(
        Date.now() + KC_PASSWORD_DEADLINE_DAYS * MS_PER_DAY
      );
      deadlineIso = deadline.toISOString();
      attrs.kc_password_deadline = [deadlineIso];
      await updateKeycloakUser(kcUser.id, {
        ...kcUser,
        attributes: attrs,
      });
      kcUser = { ...kcUser, attributes: attrs };
    }

    const { daysRemaining, deadlinePassed } = deadlineFields(deadlineIso);
    return res.json({
      needsPassword: true,
      keycloakUserId: kcUser.id,
      keycloakUserMissing: false,
      deadlineIso,
      daysRemaining,
      deadlinePassed,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/kc-password", verifyAuth0Jwt, async (req, res) => {
  const { password, passwordConfirm } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "password_too_short" });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: "password_mismatch" });
  }
  try {
    const kcUser = await findKeycloakUserForAuth0Request(req);
    if (!kcUser) {
      return res.status(404).json({ error: "keycloak_user_not_found" });
    }
    await resetUserPassword(kcUser.id, password, false);
    const attrs = { ...(kcUser.attributes || {}), kc_password_enrolled: ["true"] };
    delete attrs.kc_password_deadline;
    await updateKeycloakUser(kcUser.id, {
      ...kcUser,
      attributes: attrs,
    });
    return res.json({ ok: true, message: "keycloak_password_set" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "internal_error" });
  }
});

export default router;
