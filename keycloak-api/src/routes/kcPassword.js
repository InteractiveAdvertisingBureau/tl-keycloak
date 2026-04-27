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

function rid(req) {
  return req?.correlationId || "no-correlation-id";
}

/** Access tokens often omit `email`; UserInfo matches sync (userinfo has email). */
async function resolveEmailForLookup(req) {
  const claims = req.auth0Claims || {};
  let email =
    typeof claims.email === "string" ? claims.email.toLowerCase().trim() : "";
  if (email || !req.auth0BearerToken) return email;
  try {
    const info = await authProvider.getUserInfo(req.auth0BearerToken);
    if (info?.email) {
      email = String(info.email).toLowerCase().trim();
      console.log(
        `[tl:keycloak-api:${rid(req)}] kc_password_email_from_userinfo`,
        { hasEmail: true }
      );
    }
  } catch (e) {
    console.warn(
      `[tl:keycloak-api:${rid(req)}] kc_password_userinfo_fallback_failed`,
      { message: e.message }
    );
  }
  return email;
}

async function findKeycloakUserForAuth0Request(req) {
  const claims = req.auth0Claims || {};
  const sub = claims.sub;
  const email = await resolveEmailForLookup(req);
  console.log(`[tl:keycloak-api:${rid(req)}] kc_password_lookup_begin`, {
    hasSub: Boolean(sub),
    hasEmail: Boolean(email),
  });
  if (email) {
    const list = await findUsersByEmail(email);
    console.log(`[tl:keycloak-api:${rid(req)}] kc_password_lookup_by_email`, {
      matches: list.length,
    });
    for (const u of list) {
      if (!sub || userMatchesAuth0Id(u, sub)) {
        console.log(`[tl:keycloak-api:${rid(req)}] kc_password_lookup_email_hit`, {
          keycloakUserId: u.id,
          matchedBy: sub ? "email+auth0_id" : "email",
        });
        return u;
      }
    }
    // Backward-compatible fallback for users synced/created without auth0_id.
    // If email lookup returns exactly one user, treat it as the target and
    // backfill auth0_id from token sub for future exact lookups.
    if (list.length === 1) {
      const only = list[0];
      if (sub && !userMatchesAuth0Id(only, sub)) {
        try {
          const attrs = { ...(only.attributes || {}), auth0_id: [sub] };
          await updateKeycloakUser(only.id, { ...only, attributes: attrs });
          console.log(
            `[tl:keycloak-api:${rid(req)}] kc_password_lookup_backfilled_auth0_id`,
            { keycloakUserId: only.id }
          );
          return { ...only, attributes: attrs };
        } catch (e) {
          console.warn(
            `[tl:keycloak-api:${rid(req)}] kc_password_lookup_backfill_failed`,
            { message: e?.message }
          );
        }
      }
      console.log(
        `[tl:keycloak-api:${rid(req)}] kc_password_lookup_email_single_fallback`,
        { keycloakUserId: only.id }
      );
      return only;
    }
  }
  if (!sub) return null;
  const byAuth0Id = await findUserByAuth0Id(sub);
  console.log(`[tl:keycloak-api:${rid(req)}] kc_password_lookup_by_auth0_id`, {
    found: Boolean(byAuth0Id),
    keycloakUserId: byAuth0Id?.id || null,
  });
  return byAuth0Id;
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
    let kcUser = await findKeycloakUserForAuth0Request(req);
    if (!kcUser) {
      console.log(`[tl:keycloak-api:${rid(req)}] kc_password_status_missing_user`);
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
    console.log(`[tl:keycloak-api:${rid(req)}] kc_password_status_flags`, {
      keycloakUserId: kcUser.id,
      credentialsCount: Array.isArray(creds) ? creds.length : 0,
      hasPasswordCredential: hasPw,
      enrolledFlag: enrolled,
      needsPassword,
    });
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
      console.log(`[tl:keycloak-api:${rid(req)}] kc_password_status_deadline_initialized`, {
        keycloakUserId: kcUser.id,
        deadlineIso,
      });
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
      console.log(`[tl:keycloak-api:${rid(req)}] kc_password_set_missing_user`);
      return res.status(404).json({ error: "keycloak_user_not_found" });
    }
    await resetUserPassword(kcUser.id, password, false);
    const attrs = { ...(kcUser.attributes || {}), kc_password_enrolled: ["true"] };
    delete attrs.kc_password_deadline;
    await updateKeycloakUser(kcUser.id, {
      ...kcUser,
      attributes: attrs,
    });
    console.log(`[tl:keycloak-api:${rid(req)}] kc_password_set_success`, {
      keycloakUserId: kcUser.id,
    });
    return res.json({ ok: true, message: "keycloak_password_set" });
  } catch (e) {
    console.error(`[tl:keycloak-api:${rid(req)}] kc_password_set_failed`, e);
    return res.status(500).json({ error: e.message || "internal_error" });
  }
});

export default router;
