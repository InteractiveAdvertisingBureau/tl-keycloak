import express from "express";
import cors from "cors";
import * as jose from "jose";
import * as authProvider from "./services/auth.provider.js";
import { syncUserToKeycloak } from "./services/userSync.service.js";
import webhookRoutes from "./routes/webhooks.js";
import kcPasswordRoutes from "./routes/kcPassword.js";
import * as kc from "./services/keycloak.service.js";
import {
  ensureAuthzIdentity,
  getAuthzUserEmail,
  linkAuthzIdentity,
  resolveAuthzIdentity,
} from "./services/authzClient.js";
import {
  correlationMiddleware,
  tlLog,
  tlWarn,
  tlError,
} from "./lib/correlationLog.js";

const PORT = Number(process.env.PORT || 4000);

function isCompactJwtAccessTokenShape(s) {
  if (typeof s !== "string") return false;
  const parts = s.trim().split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(correlationMiddleware("keycloak-api"));

function auth0Issuer() {
  const raw = process.env.AUTH0_DOMAIN || "";
  const d = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return process.env.AUTH0_ISSUER || (d ? `https://${d}/` : "");
}

async function afterAuth0Login(tokens) {
  const profile = await authProvider.getUserInfo(tokens.access_token);
  const iss = auth0Issuer();
  if (!iss) return;
  const internal = await ensureAuthzIdentity({
    issuer: iss,
    subject: profile.sub,
    email: profile.email,
  });
  syncUserToKeycloak({ ...profile, app_user_id: internal }).catch((err) =>
    console.error("[tl:keycloak-api] sync after auth0 login", err)
  );
}

async function afterKeycloakLogin(tokens, loginIdentifier) {
  const claims = jose.decodeJwt(tokens.access_token);
  const kcIss = kc.keycloakRealmIssuer();
  const jwtSub = claims.sub;
  if (!jwtSub) return;

  const already = await resolveAuthzIdentity({ issuer: kcIss, subject: jwtSub });
  if (already) return;

  const kcUser = await kc.findUserForLoginIdentifier(loginIdentifier);
  const loginEmail =
    (typeof claims.email === "string" && claims.email.toLowerCase()) ||
    (typeof claims.preferred_username === "string" &&
    claims.preferred_username.includes("@")
      ? claims.preferred_username.toLowerCase()
      : null) ||
    (kcUser?.email ? String(kcUser.email).toLowerCase() : null);

  const appIdFromKc = kcUser?.attributes?.app_user_id?.[0];
  if (appIdFromKc && loginEmail) {
    const authzEmail = await getAuthzUserEmail(appIdFromKc);
    if (authzEmail && authzEmail === loginEmail) {
      await linkAuthzIdentity({
        userId: appIdFromKc,
        issuer: kcIss,
        subject: jwtSub,
      });
      return;
    }
  }

  if (loginEmail) {
    await ensureAuthzIdentity({
      issuer: kcIss,
      subject: jwtSub,
      email: loginEmail,
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", kcPasswordRoutes);

function keycloakSignupUsername(email, usernameField) {
  const u = typeof usernameField === "string" ? usernameField.trim() : "";
  if (u) return u;
  const e = String(email || "").trim();
  if (e.includes("@")) return e.split("@")[0] || `user_${Date.now()}`;
  return `user_${Date.now()}`;
}

/** New accounts are created in Keycloak only; Auth0 is not used for registration. */
app.post("/signup", async (req, res) => {
  const { email, password } = req.body || {};
  const rawUsername = req.body?.username;
  const usernameField =
    typeof rawUsername === "string" && rawUsername.trim() !== ""
      ? rawUsername.trim()
      : undefined;

  tlLog(req, "route_signup_begin_keycloak_only", {
    email: typeof email === "string" ? email : undefined,
    hasUsername: Boolean(usernameField),
  });

  if (!email || !password) {
    return res.status(400).json({
      error: "email_and_password_required",
      correlationId: req.correlationId,
    });
  }

  const em = String(email).trim().toLowerCase();
  const kcUsername = keycloakSignupUsername(em, usernameField);

  try {
    const existingKc = await kc.findUsersByEmail(em);
    if (existingKc.length) {
      const u = existingKc[0];
      if (await kc.shouldUseKeycloakLogin(u)) {
        tlLog(req, "route_signup_blocked_existing_keycloak_user");
        return res.status(409).json({
          error: "account_exists_use_keycloak_login",
          correlationId: req.correlationId,
        });
      }
      tlLog(req, "route_signup_blocked_email_in_keycloak");
      return res.status(409).json({
        error: "account_exists",
        correlationId: req.correlationId,
      });
    }
  } catch (e) {
    tlWarn(req, "kc_signup_precheck_failed_nonfatal", { message: e?.message });
  }

  let userId;
  try {
    const created = await kc.createKeycloakUser({
      username: kcUsername,
      email: em,
      enabled: true,
      emailVerified: false,
      firstName: "",
      lastName: "",
      attributes: { kc_password_enrolled: ["true"] },
    });
    userId =
      created.id ||
      (await kc.findUsersByEmail(em))[0]?.id ||
      null;
    if (!userId) {
      throw new Error("keycloak_user_id_unresolved_after_create");
    }
    tlLog(req, "route_signup_keycloak_user_created", { userId });
    await kc.resetUserPassword(userId, password, false);
  } catch (e) {
    tlError(req, "signup_keycloak_create_failed", e);
    const status = e.status === 409 ? 409 : 400;
    return res.status(status).json({
      error: e.message || "signup_failed",
      correlationId: req.correlationId,
    });
  }

  try {
    const kcIss = kc.keycloakRealmIssuer();
    const appUserId = await ensureAuthzIdentity({
      issuer: kcIss,
      subject: userId,
      email: em,
    });
    if (appUserId) {
      const ku = await kc.getUserById(userId);
      if (ku) {
        await kc.updateKeycloakUser(userId, {
          ...ku,
          attributes: {
            ...(ku.attributes || {}),
            app_user_id: [String(appUserId)],
            kc_password_enrolled: ["true"],
          },
        });
      }
    }
    tlLog(req, "route_signup_authz_provisioned");
  } catch (e) {
    tlWarn(req, "signup_authz_provision_nonfatal", { message: e?.message });
  }

  return res.json({
    message: "User created successfully",
    correlationId: req.correlationId,
  });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  tlLog(req, "route_login_begin", {
    userHint:
      typeof username === "string"
        ? username.includes("@")
          ? "email"
          : "opaque"
        : "none",
  });

  if (!username || !password) {
    return res.status(400).json({
      error: "username_and_password_required",
      correlationId: req.correlationId,
    });
  }

  try {
    const kcUser = await kc.findUserForLoginIdentifier(username);
    if (kcUser && (await kc.shouldUseKeycloakLogin(kcUser))) {
      tlLog(req, "route_login_keycloak_ropg_branch");
      const tokens = await kc.loginWithResourceOwnerPassword(
        username,
        password
      );
      await afterKeycloakLogin(tokens, username);
      return res.json(tokens);
    }
  } catch (e) {
    if (e.status === 501) {
      tlWarn(req, "kc_ropg_not_configured_fallback_auth0");
    } else if (e.status === 401) {
      tlLog(req, "route_login_keycloak_rejected_401");
      return res.status(401).json({
        error: "Incorrect password",
        correlationId: req.correlationId,
      });
    } else {
      tlError(req, "kc_login_branch_error", e);
    }
  }

  try {
    const tokens = await authProvider.loginWithPassword({
      username,
      password,
      correlationId: req.correlationId,
    });
    if (!isCompactJwtAccessTokenShape(tokens.access_token)) {
      tlWarn(req, "auth0_access_token_not_jwt", {
        hint: "Set AUTH0_AUDIENCE so Auth0 returns a JWT access token the api-gateway can verify.",
      });
      return res.status(400).json({
        error: "auth0_access_token_not_jwt",
        message:
          "Auth0 returned a non-JWT access token (often opaque). Set AUTH0_AUDIENCE to your Auth0 API identifier for keycloak-api and api-gateway, then sign in again.",
        correlationId: req.correlationId,
      });
    }
    await afterAuth0Login(tokens);
    tlLog(req, "route_login_auth0_ok");
    return res.json(tokens);
  } catch (e) {
    tlError(req, "route_login_auth0_failed", e);
    const status = e.status || 400;
    if (status === 401) {
      return res.status(401).json({
        error: "Incorrect password",
        correlationId: req.correlationId,
      });
    }
    return res.status(status).json({
      error: e.message,
      details: e.payload,
      correlationId: req.correlationId,
    });
  }
});

app.use("/webhooks/auth0", webhookRoutes);

app.listen(PORT, "0.0.0.0", () => {
  kc.logKeycloakStartupConfig();
  const auth0Domain = (process.env.AUTH0_DOMAIN || "").trim();
  const auth0Audience = (process.env.AUTH0_AUDIENCE || "").trim();
  if (auth0Domain && !auth0Audience) {
    console.warn(
      "[tl:keycloak-api] AUTH0_AUDIENCE is unset. Set it to your Auth0 API identifier (Dashboard → Applications → APIs) so password login returns a JWT access_token."
    );
  }
  console.log(`keycloak-api listening on ${PORT}`);
});
