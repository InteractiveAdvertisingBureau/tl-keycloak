import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { authenticateJwt } from "./middleware/auth.js";
import {
  correlationMiddleware,
  tlLog,
  tlError,
} from "./lib/correlationLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const KEYCLOAK_API_URL = process.env.KEYCLOAK_API_URL || "http://localhost:4004";
const AUTHZ_BASE_URL = process.env.AUTHZ_BASE_URL || "http://localhost:4001";
const MOCK_SERVICE_URL = process.env.MOCK_SERVICE_URL || "http://localhost:4002";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:4003";
const APP_BASE_PATH = (process.env.APP_BASE_PATH || "").replace(/\/$/, "");

async function authzCheckAllowed(userId, action) {
  try {
    const check = await fetch(`${AUTHZ_BASE_URL}/authz/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    const result = await check.json();
    return check.ok && Boolean(result.allowed);
  } catch {
    return false;
  }
}

function normalizeDomain(d) {
  return (d || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function corsMiddleware() {
  return cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Correlation-ID",
      "X-Request-ID",
    ],
  });
}

async function proxyJson(req, res, targetPath) {
  const url = `${KEYCLOAK_API_URL}${targetPath}`;
  tlLog(req, `proxy_keycloak_begin`, { targetPath, upstreamBase: KEYCLOAK_API_URL });
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": req.correlationId,
      },
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      tlLog(req, `proxy_keycloak_response_error`, {
        targetPath,
        status: r.status,
        bodyError: data?.error ?? data?.code,
      });
    }
    res.status(r.status).json(data);
  } catch (e) {
    tlError(req, `proxy_keycloak_unreachable ${targetPath}`, e);
    res.status(502).json({
      error: "upstream_error",
      correlationId: req.correlationId,
    });
  }
}

async function proxyToKeycloakApi(req, res, upstreamPath) {
  const url = `${KEYCLOAK_API_URL}${upstreamPath}`;
  const headers = { "X-Correlation-ID": req.correlationId };
  const ct = req.headers["content-type"];
  if (ct) headers["Content-Type"] = ct;
  else if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }
  const auth = req.headers.authorization;
  if (auth) headers.Authorization = auth;
  tlLog(req, `proxy_keycloak_begin`, { upstreamPath });
  try {
    const r = await fetch(url, {
      method: req.method,
      headers,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body ?? {})
          : undefined,
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      tlLog(req, `proxy_keycloak_response_error`, {
        upstreamPath,
        status: r.status,
      });
    }
    res.status(r.status).json(data);
  } catch (e) {
    tlError(req, `proxy_keycloak_unreachable ${upstreamPath}`, e);
    res.status(502).json({
      error: "upstream_error",
      correlationId: req.correlationId,
    });
  }
}

const kcPasswordPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function createApp() {
  const app = express();
  app.use(corsMiddleware());
  app.use(express.json());
  app.use(correlationMiddleware("api-gateway"));

  const base = APP_BASE_PATH || "";

  app.get(`${base}/health`, (_req, res) => {
    res.json({ status: "ok", service: "api-gateway" });
  });

  app.use(
    `${base}/sdk/v1`,
    express.static(path.join(__dirname, "../public/sdk/v1"), {
      maxAge: "1y",
      immutable: true,
      fallthrough: true,
    })
  );

  app.get(`${base}/callback`, async (req, res) => {
    const { code, error, error_description } = req.query;
    if (error) {
      return res
        .status(400)
        .send(
          `<html><body><p>${error}: ${error_description || ""}</p></body></html>`
        );
    }
    if (!code) {
      return res.status(400).send("missing code");
    }
    const domain = normalizeDomain(process.env.AUTH0_DOMAIN);
    const clientId = process.env.AUTH0_CLIENT_ID;
    const clientSecret = process.env.AUTH0_CLIENT_SECRET;
    const redirectUri =
      process.env.AUTH0_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}${base}/callback`;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: redirectUri,
    });
    const auth0Audience = (process.env.AUTH0_AUDIENCE || "").trim();
    if (auth0Audience) {
      body.set("audience", auth0Audience);
    }

    const tokenRes = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).json(tokens);
    }
    const access = tokens.access_token || "";
    const hash = new URLSearchParams({
      access_token: access,
      id_token: tokens.id_token || "",
      token_type: tokens.token_type || "Bearer",
    });
    const redirect = `${FRONTEND_URL}#${hash.toString()}`;
    res.redirect(302, redirect);
  });

  app.post(`${base}/login`, (req, res) => proxyJson(req, res, "/login"));
  app.post(`${base}/signup`, (req, res) => proxyJson(req, res, "/signup"));

  app.get(`${base}/auth/kc-password-status`, (req, res) =>
    proxyToKeycloakApi(req, res, "/auth/kc-password-status")
  );
  app.post(
    `${base}/auth/kc-password`,
    kcPasswordPostLimiter,
    (req, res) => proxyToKeycloakApi(req, res, "/auth/kc-password")
  );

  app.get(`${base}/me`, authenticateJwt, async (req, res) => {
    const userId = req.user.userId;
    try {
      const r = await fetch(
        `${AUTHZ_BASE_URL}/authz/me/${encodeURIComponent(userId)}`
      );
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json(data);
      }
      return res.json({
        user: {
          sub: req.user.sub,
          email: req.user.email ?? data.email,
          userId: req.user.userId,
        },
        roles: data.roles,
        permissions: data.permissions,
        dashboard: data.dashboard,
      });
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  app.get(`${base}/me/dashboard`, authenticateJwt, async (req, res) => {
    const userId = req.user.userId;
    try {
      const r = await fetch(
        `${AUTHZ_BASE_URL}/authz/dashboard/${encodeURIComponent(userId)}`
      );
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json(data);
      }
      return res.json(data);
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  app.post(`${base}/admin/create-user`, authenticateJwt, async (req, res) => {
    const userId = req.user.userId;
    try {
      const check = await fetch(`${AUTHZ_BASE_URL}/authz/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "CREATE_USER" }),
      });
      const result = await check.json();
      if (!check.ok || !result.allowed) {
        return res.status(403).json({ error: "forbidden" });
      }
      return res.json({
        message: "User created (mock)",
        payload: req.body || {},
      });
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  app.get(`${base}/admin/users`, authenticateJwt, async (req, res) => {
    const userId = req.user.userId;
    try {
      const ok = await authzCheckAllowed(userId, "VIEW_USERS");
      if (!ok) {
        return res.status(403).json({ error: "forbidden" });
      }
      const r = await fetch(`${AUTHZ_BASE_URL}/authz/users`);
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json(data);
      }
      return res.json(data);
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  app.get(`${base}/admin/roles`, authenticateJwt, async (req, res) => {
    const userId = req.user.userId;
    try {
      const ok = await authzCheckAllowed(userId, "VIEW_USERS");
      if (!ok) {
        return res.status(403).json({ error: "forbidden" });
      }
      const r = await fetch(`${AUTHZ_BASE_URL}/authz/roles/catalog`);
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json(data);
      }
      return res.json(data);
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  app.patch(`${base}/admin/users/:userId/roles`, authenticateJwt, async (req, res) => {
    const actorId = req.user.userId;
    try {
      const ok = await authzCheckAllowed(actorId, "MANAGE_USER_ROLES");
      if (!ok) {
        return res.status(403).json({ error: "forbidden" });
      }
      const targetId = req.params.userId;
      const r = await fetch(
        `${AUTHZ_BASE_URL}/authz/users/${encodeURIComponent(targetId)}/roles`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: req.body?.roles }),
        }
      );
      const text = await r.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      return res.status(r.status).json(data);
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: "authz_unreachable" });
    }
  });

  const adminProxy = createProxyMiddleware({
    target: MOCK_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) =>
      `/admin${path === "/" ? "" : path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        const email = req.user?.email || "";
        const sub = req.user?.sub || "";
        if (sub) proxyReq.setHeader("x-user-id", sub);
        if (email) proxyReq.setHeader("x-user-email", email);
      },
    },
  });

  const userProxy = createProxyMiddleware({
    target: MOCK_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path) =>
      `/user${path === "/" ? "" : path}`,
    on: {
      proxyReq: (proxyReq, req) => {
        const email = req.user?.email || "";
        const sub = req.user?.sub || "";
        if (sub) proxyReq.setHeader("x-user-id", sub);
        if (email) proxyReq.setHeader("x-user-email", email);
      },
    },
  });

  app.use(`${base}/admin`, authenticateJwt, adminProxy);
  app.use(`${base}/user`, authenticateJwt, userProxy);

  return app;
}

function logKeycloakGatewayEnv() {
  const cfg = {
    KEYCLOAK_API_URL,
    KEYCLOAK_JWKS_URI: process.env.KEYCLOAK_JWKS_URI || null,
    KEYCLOAK_INTERNAL_BASE_URL: process.env.KEYCLOAK_INTERNAL_BASE_URL || null,
    KEYCLOAK_AUDIENCE: process.env.KEYCLOAK_AUDIENCE || null,
    envKeysMatchingKeycloak: Object.keys(process.env)
      .filter((k) => /^KEYCLOAK/i.test(k))
      .sort(),
  };
  console.log("[tl:api-gateway] keycloak-related env", JSON.stringify(cfg, null, 2));
}

function warnAuth0AudienceIfNeeded() {
  const domain = (process.env.AUTH0_DOMAIN || "").trim();
  const aud = (process.env.AUTH0_AUDIENCE || "").trim();
  if (domain && !aud) {
    console.warn(
      "[tl:api-gateway] AUTH0_DOMAIN is set but AUTH0_AUDIENCE is empty. Auth0 returns opaque access tokens; set AUTH0_AUDIENCE to your Auth0 API identifier (same as keycloak-api / frontend)."
    );
  }
}

const app = createApp();
app.listen(PORT, "0.0.0.0", () => {
  logKeycloakGatewayEnv();
  warnAuth0AudienceIfNeeded();
  console.log(`api-gateway listening on ${PORT} basePath=${APP_BASE_PATH || "/"}`);
});
