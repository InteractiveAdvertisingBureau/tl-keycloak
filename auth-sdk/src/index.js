const TOKEN_KEY = "access_token";

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function injectStyles() {
  if (document.getElementById("tl-auth-sdk-styles")) return;
  const style = document.createElement("style");
  style.id = "tl-auth-sdk-styles";
  style.textContent = `
    .tl-auth-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,-apple-system,sans-serif}
    .tl-auth-card{background:#fff;border-radius:12px;padding:24px;width:min(400px,92vw);box-shadow:0 25px 50px -12px rgba(0,0,0,.25)}
    .tl-auth-card h2{margin:0 0 16px;font-size:1.25rem}
    .tl-auth-field{margin-bottom:12px}
    .tl-auth-field label{display:block;font-size:.85rem;margin-bottom:4px;color:#334155}
    .tl-auth-field input{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box}
    .tl-auth-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
    .tl-auth-actions button{padding:10px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-family:inherit}
    .tl-auth-actions button.primary{background:#2563eb;color:#fff}
    .tl-auth-actions button.ghost{background:#e2e8f0;color:#0f172a}
    .tl-auth-error{color:#b91c1c;font-size:.85rem;margin-top:8px;white-space:pre-wrap;max-height:40vh;overflow:auto}
    .tl-auth-embed{width:100%;max-width:420px;font-family:system-ui,-apple-system,sans-serif}
    .tl-auth-embed .tl-auth-embed-title{margin:0 0 16px;font-size:1.15rem;font-weight:600;color:#0f172a}
    .tl-auth-embed .tl-auth-divider{margin:16px 0;text-align:center;font-size:.8rem;color:#64748b;position:relative}
    .tl-auth-embed .tl-auth-divider::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#e2e8f0;z-index:0}
    .tl-auth-embed .tl-auth-divider span{background:#fff;padding:0 10px;position:relative;z-index:1}
    .tl-auth-embed .tl-auth-auth0-btn{width:100%;padding:10px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-weight:600;font-family:inherit;color:#0f172a}
    .tl-auth-embed .tl-auth-auth0-btn:hover{background:#f8fafc}
  `;
  document.head.appendChild(style);
}

function modal(title, fields, onSubmit, onCancel) {
  injectStyles();
  const overlay = el(`
    <div class="tl-auth-overlay" role="dialog">
      <div class="tl-auth-card">
        <h2></h2>
        <form></form>
        <div class="tl-auth-error"></div>
      </div>
    </div>
  `);
  overlay.querySelector("h2").textContent = title;
  const form = overlay.querySelector("form");
  const errEl = overlay.querySelector(".tl-auth-error");
  for (const f of fields) {
    const wrap = el(`
      <div class="tl-auth-field">
        <label></label>
        <input />
      </div>
    `);
    wrap.querySelector("label").textContent = f.label;
    const input = wrap.querySelector("input");
    input.name = f.name;
    input.type = f.type || "text";
    input.required = true;
    input.autocomplete = f.autocomplete || "on";
    form.appendChild(wrap);
  }
  const actions = el(`
    <div class="tl-auth-actions">
      <button type="button" class="ghost">Cancel</button>
      <button type="submit" class="primary">Continue</button>
    </div>
  `);
  form.appendChild(actions);

  function close() {
    overlay.remove();
  }
  function cancel() {
    if (onCancel) onCancel();
    close();
  }
  actions.querySelector("button.ghost").addEventListener("click", cancel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cancel();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const fd = new FormData(form);
    const data = {};
    for (const [k, v] of fd.entries()) data[k] = String(v);
    try {
      await onSubmit(data);
      close();
    } catch (err) {
      errEl.textContent = err.message || "Request failed";
    }
  });

  document.body.appendChild(overlay);
  form.querySelector("input")?.focus();
}

/**
 * Mount email/password (and optional Auth0) form into a host element.
 * @returns {{ unmount: () => void }}
 */
function mountAuthForm(container, { title, fields, submitLabel, onSubmit, showAuth0 }) {
  injectStyles();
  if (!container || !container.appendChild) {
    throw new Error("mountAuthForm: container must be a DOM element");
  }
  const root = el(`
    <div class="tl-auth-embed">
      ${title ? `<h2 class="tl-auth-embed-title"></h2>` : ""}
      <form></form>
      <div class="tl-auth-error"></div>
    </div>
  `);
  if (title) {
    root.querySelector(".tl-auth-embed-title").textContent = title;
  }
  const form = root.querySelector("form");
  const errEl = root.querySelector(".tl-auth-error");
  for (const f of fields) {
    const wrap = el(`
      <div class="tl-auth-field">
        <label></label>
        <input />
      </div>
    `);
    wrap.querySelector("label").textContent = f.label;
    const input = wrap.querySelector("input");
    input.name = f.name;
    input.type = f.type || "text";
    input.required = true;
    input.autocomplete = f.autocomplete || "on";
    form.appendChild(wrap);
  }
  const actions = el(`
    <div class="tl-auth-actions">
      <button type="submit" class="primary"></button>
    </div>
  `);
  actions.querySelector("button.primary").textContent = submitLabel || "Continue";
  form.appendChild(actions);

  let auth0Btn = null;
  if (showAuth0) {
    const divider = el(`<div class="tl-auth-divider"><span>or</span></div>`);
    auth0Btn = el(
      `<button type="button" class="tl-auth-auth0-btn">Continue with Auth0</button>`
    );
    auth0Btn.addEventListener("click", () => {
      errEl.textContent = "";
      try {
        window.AuthSDK.loginWithAuth0();
      } catch (e) {
        errEl.textContent = e.message || "Auth0 redirect failed";
      }
    });
    root.appendChild(divider);
    root.appendChild(auth0Btn);
  }

  const onFormSubmit = async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const fd = new FormData(form);
    const data = {};
    for (const [k, v] of fd.entries()) data[k] = String(v);
    try {
      await onSubmit(data);
    } catch (err) {
      errEl.textContent = err.message || "Request failed";
    }
  };
  form.addEventListener("submit", onFormSubmit);

  container.appendChild(root);
  form.querySelector("input")?.focus();

  return {
    unmount() {
      form.removeEventListener("submit", onFormSubmit);
      root.remove();
    },
  };
}

const state = {
  gatewayBaseUrl: "",
  auth0Domain: "",
  auth0ClientId: "",
  auth0Audience: "",
  redirectUri: "",
};

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function accessTokenIsAuth0(token) {
  const p = decodeJwtPayload(token);
  const iss = p?.iss || "";
  if (typeof iss !== "string") return false;
  if (iss.includes("auth0.com")) return true;
  const domain = (state.auth0Domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!domain) return false;
  try {
    return new URL(iss).hostname === domain;
  } catch {
    return false;
  }
}

/**
 * Decode JWT shape locally (no signature verify). Use to see whether the
 * stored token looks like Keycloak vs Auth0, or opaque / malformed.
 */
function describeAccessTokenShape(token) {
  if (token == null || token === "") {
    return { shape: "empty", issuerKind: null };
  }
  if (typeof token !== "string") {
    return { shape: "invalid_type", issuerKind: null };
  }
  const t = token.trim();
  const parts = t.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    return {
      shape: "not_jwt",
      segmentCount: parts.length,
      issuerKind: null,
      note:
        "Cannot read issuer: not a JWT. Auth0 often returns opaque access tokens unless AUTH0_AUDIENCE is set (password grant + /callback token exchange).",
    };
  }
  const payload = decodeJwtPayload(t);
  if (!payload || typeof payload.iss !== "string") {
    return { shape: "jwt_unreadable_payload", issuerKind: null };
  }
  const iss = payload.iss;
  let issuerKind = "unknown_oidc";
  if (/\/realms\//.test(iss)) {
    issuerKind = "keycloak";
  } else if (iss.includes("auth0.com")) {
    issuerKind = "auth0";
  } else {
    const domain = (state.auth0Domain || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    if (domain) {
      try {
        if (new URL(iss).hostname === domain) issuerKind = "auth0";
      } catch {
        /* ignore */
      }
    }
  }
  return {
    shape: "jwt",
    issuerKind,
    iss,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    note: "Payload decoded locally (signature not verified).",
  };
}

function augmentInvalidTokenMessage(token, baseMessage) {
  const d = describeAccessTokenShape(token);
  if (d.shape === "not_jwt") {
    return `${baseMessage} — ${d.note}`;
  }
  if (d.shape === "jwt" && d.iss) {
    return `${baseMessage} — Token looks like ${d.issuerKind} (unverified iss=${d.iss})`;
  }
  return baseMessage;
}

function kcSyncWaitOverlay() {
  injectStyles();
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="tl-auth-overlay" role="dialog">
        <div class="tl-auth-card">
          <h2>Finishing setup</h2>
          <p style="margin:0 0 16px;color:#334155;font-size:.9rem;line-height:1.4">
            Your account is still syncing to Keycloak. Wait a few seconds and retry, or sign out and sign in again with Auth0.
          </p>
          <div class="tl-auth-actions">
            <button type="button" class="ghost">Cancel</button>
            <button type="button" class="primary">Retry</button>
          </div>
        </div>
      </div>
    `);
    overlay.querySelector("button.ghost").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector("button.primary").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
    document.body.appendChild(overlay);
  });
}

function api(path, options = {}) {
  const url = `${state.gatewayBaseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export const AuthSDK = {
  init(opts) {
    state.gatewayBaseUrl = (opts.gatewayBaseUrl || "").replace(/\/$/, "");
    state.auth0Domain = opts.auth0Domain || "";
    state.auth0ClientId = opts.auth0ClientId || "";
    state.auth0Audience = opts.auth0Audience || "";
    state.redirectUri =
      opts.redirectUri || `${state.gatewayBaseUrl}/callback`;
    if (opts.onReady) opts.onReady();
  },

  getAccessToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  /** Inspect stored token shape and `iss` (JWT only; opaque tokens have no issuer). */
  describeAccessToken(token) {
    const raw = token !== undefined && token !== null ? token : this.getAccessToken();
    return describeAccessTokenShape(raw);
  },

  setAccessToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tl-auth-token"));
      }
    } catch {
      /* ignore */
    }
  },

  captureOAuthHash() {
    if (!window.location.hash || window.location.hash.length < 2) return false;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get("access_token");
    if (access) {
      this.setAccessToken(access);
      const clean = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", clean);
      return true;
    }
    return false;
  },

  buildAuth0AuthorizeUrl() {
    const domain = state.auth0Domain.replace(/^https?:\/\//, "");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: state.auth0ClientId,
      redirect_uri: state.redirectUri,
      scope: "openid profile email",
    });
    if (state.auth0Audience) q.set("audience", state.auth0Audience);
    return `https://${domain}/authorize?${q.toString()}`;
  },

  loginWithAuth0() {
    window.location.assign(this.buildAuth0AuthorizeUrl());
  },

  /**
   * @param {HTMLElement} container
   * @param {{ onSuccess?: () => void, onError?: (err: Error) => void }} [callbacks]
   */
  mountLogin(container, callbacks = {}) {
    if (!state.gatewayBaseUrl) throw new Error("AuthSDK.init first");
    const showAuth0 = Boolean(state.auth0ClientId);
    return mountAuthForm(container, {
      title: "",
      fields: [
        {
          name: "username",
          label: "Email or username",
          type: "text",
          autocomplete: "username",
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "current-password",
        },
      ],
      submitLabel: "Sign in",
      showAuth0,
      onSubmit: async (data) => {
        try {
          const res = await api("/login", {
            method: "POST",
            body: JSON.stringify({
              username: data.username,
              password: data.password,
            }),
          });
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body.error || body.message || "Login failed");
          }
          if (body.access_token) {
            this.setAccessToken(body.access_token);
          }
          callbacks.onSuccess?.();
        } catch (e) {
          callbacks.onError?.(e);
          throw e;
        }
      },
    });
  },

  /**
   * @param {HTMLElement} container
   * @param {{ onSuccess?: () => void, onError?: (err: Error) => void }} [callbacks]
   */
  mountSignup(container, callbacks = {}) {
    if (!state.gatewayBaseUrl) throw new Error("AuthSDK.init first");
    return mountAuthForm(container, {
      title: "",
      fields: [
        {
          name: "username",
          label: "Username",
          type: "text",
          autocomplete: "username",
        },
        {
          name: "email",
          label: "Email",
          type: "email",
          autocomplete: "email",
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "new-password",
        },
      ],
      submitLabel: "Create account",
      showAuth0: false,
      onSubmit: async (data) => {
        try {
          const res = await api("/signup", {
            method: "POST",
            body: JSON.stringify({
              username: data.username,
              email: data.email,
              password: data.password,
            }),
          });
          const body = await res.json();
          if (!res.ok) {
            if (
              res.status === 409 &&
              body.error === "account_exists_use_keycloak_login"
            ) {
              const ref = body.correlationId
                ? ` Reference ID: ${body.correlationId}`
                : "";
              throw new Error(
                `This email already has a Keycloak password. Sign in with email and password instead of creating a new account.${ref}`
              );
            }
            if (res.status === 409 && body.error === "account_exists") {
              const ref = body.correlationId
                ? ` Reference ID: ${body.correlationId}`
                : "";
              throw new Error(
                `An account with this email already exists. Try signing in instead.${ref}`
              );
            }
            let msg = body.error || body.message || "Signup failed";
            if (Array.isArray(body.auth0Checks) && body.auth0Checks.length) {
              msg = `${msg}\n\n${body.auth0Checks
                .map((line, i) => `${i + 1}. ${line}`)
                .join("\n")}`;
            }
            if (body.correlationId) {
              msg = `${msg}\n\nReference ID: ${body.correlationId} (grep server logs for this value)`;
            }
            throw new Error(msg);
          }
          const loginRes = await api("/login", {
            method: "POST",
            body: JSON.stringify({
              username: data.email,
              password: data.password,
            }),
          });
          const tokens = await loginRes.json();
          if (!loginRes.ok) {
            throw new Error(
              tokens.error ||
                "Account created but sign-in failed — try logging in."
            );
          }
          if (tokens.access_token) {
            this.setAccessToken(tokens.access_token);
          }
          callbacks.onSuccess?.();
        } catch (e) {
          callbacks.onError?.(e);
          throw e;
        }
      },
    });
  },

  async login() {
    if (!state.gatewayBaseUrl) throw new Error("AuthSDK.init first");
    modal(
      "Sign in",
      [
        {
          name: "username",
          label: "Email or username",
          type: "text",
          autocomplete: "username",
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "current-password",
        },
      ],
      async (data) => {
        const res = await api("/login", {
          method: "POST",
          body: JSON.stringify({
            username: data.username,
            password: data.password,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || body.message || "Login failed");
        }
        if (body.access_token) {
          this.setAccessToken(body.access_token);
        }
      }
    );
  },

  async signup() {
    if (!state.gatewayBaseUrl) throw new Error("AuthSDK.init first");
    modal(
      "Create account",
      [
        {
          name: "username",
          label: "Username",
          type: "text",
          autocomplete: "username",
        },
        {
          name: "email",
          label: "Email",
          type: "email",
          autocomplete: "email",
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "new-password",
        },
      ],
      async (data) => {
        const res = await api("/signup", {
          method: "POST",
          body: JSON.stringify({
            username: data.username,
            email: data.email,
            password: data.password,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          if (
            res.status === 409 &&
            body.error === "account_exists_use_keycloak_login"
          ) {
            const ref = body.correlationId
              ? ` Reference ID: ${body.correlationId}`
              : "";
            throw new Error(
              `This email already has a Keycloak password. Sign in with email and password instead of creating a new account.${ref}`
            );
          }
          if (res.status === 409 && body.error === "account_exists") {
            const ref = body.correlationId
              ? ` Reference ID: ${body.correlationId}`
              : "";
            throw new Error(
              `An account with this email already exists. Try signing in instead.${ref}`
            );
          }
          let msg = body.error || body.message || "Signup failed";
          if (Array.isArray(body.auth0Checks) && body.auth0Checks.length) {
            msg = `${msg}\n\n${body.auth0Checks
              .map((line, i) => `${i + 1}. ${line}`)
              .join("\n")}`;
          }
          if (body.correlationId) {
            msg = `${msg}\n\nReference ID: ${body.correlationId} (grep server logs for this value)`;
          }
          throw new Error(msg);
        }
        const loginRes = await api("/login", {
          method: "POST",
          body: JSON.stringify({
            username: data.email,
            password: data.password,
          }),
        });
        const tokens = await loginRes.json();
        if (!loginRes.ok) {
          throw new Error(
            tokens.error || "Account created but sign-in failed — try logging in."
          );
        }
        if (tokens.access_token) {
          this.setAccessToken(tokens.access_token);
        }
      }
    );
  },

  async getKcPasswordStatus() {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/auth/kc-password-status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  async setKcPassword(password, passwordConfirm) {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/auth/kc-password", {
      method: "POST",
      body: JSON.stringify({ password, passwordConfirm }),
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || body.message || "set_password_failed");
    }
    return body;
  },

  isAuth0AccessToken(token) {
    return Boolean(token && accessTokenIsAuth0(token));
  },

  /**
   * Opens the Keycloak password enrollment modal (Auth0 sessions only).
   * Used from the portal banner CTA; not run automatically on login.
   */
  async promptKcPasswordEnrollment() {
    if (!state.gatewayBaseUrl) return;
    const token = this.getAccessToken();
    if (!token || !accessTokenIsAuth0(token)) return;

    for (;;) {
      const res = await api("/auth/kc-password-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const status = await res.json();
      if (!res.ok) return;
      if (!status.needsPassword) return;

      if (status.keycloakUserMissing) {
        const retry = await kcSyncWaitOverlay();
        if (!retry) return;
        continue;
      }

      const completed = await new Promise((resolve) => {
        modal(
          "Set Keycloak password",
          [
            {
              name: "password",
              label: "New password (min 8 characters)",
              type: "password",
              autocomplete: "new-password",
            },
            {
              name: "passwordConfirm",
              label: "Confirm password",
              type: "password",
              autocomplete: "new-password",
            },
          ],
          async (data) => {
            await this.setKcPassword(data.password, data.passwordConfirm);
            resolve(true);
          },
          () => resolve(false)
        );
      });
      if (!completed) return;
    }
  },

  async fetchDashboard() {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/me/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      let msg = [body.error, body.hint].filter(Boolean).join(" — ") || "dashboard_failed";
      if (res.status === 401 && body.error === "invalid_token") {
        msg = augmentInvalidTokenMessage(token, msg);
      }
      throw new Error(msg);
    }
    return res.json();
  },

  /** Session + roles + permissions + dashboard config from the gateway (authz-backed). */
  async fetchMe() {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      let msg = [body.error, body.hint].filter(Boolean).join(" — ") || "me_failed";
      if (res.status === 401 && body.error === "invalid_token") {
        msg = augmentInvalidTokenMessage(token, msg);
      }
      throw new Error(msg);
    }
    return res.json();
  },

  /** Requires `VIEW_USERS`. Returns `{ users: [{ id, email, roles }] }`. */
  async fetchAdminUsers() {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = body.error || "admin_users_failed";
      if (res.status === 401 && body.error === "invalid_token") {
        msg = augmentInvalidTokenMessage(token, msg);
      }
      throw new Error(msg);
    }
    return body;
  },

  /** Requires `VIEW_USERS`. Returns `{ roles: [{ name, description }] }`. */
  async fetchAdminRolesCatalog() {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api("/admin/roles", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = body.error || "admin_roles_failed";
      if (res.status === 401 && body.error === "invalid_token") {
        msg = augmentInvalidTokenMessage(token, msg);
      }
      throw new Error(msg);
    }
    return body;
  },

  /**
   * Requires `MANAGE_USER_ROLES`. Replaces the user's roles (non-empty list of role names).
   * @param {string} userId
   * @param {string[]} roles
   */
  async updateUserRoles(userId, roles) {
    const token = this.getAccessToken();
    if (!token) throw new Error("not_authenticated");
    const res = await api(
      `/admin/users/${encodeURIComponent(userId)}/roles`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roles }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        body.error ||
        (typeof body.raw === "string" ? body.raw : null) ||
        "update_roles_failed";
      if (res.status === 401 && body.error === "invalid_token") {
        throw new Error(augmentInvalidTokenMessage(token, String(msg)));
      }
      throw new Error(String(msg));
    }
    return body;
  },

  logout() {
    this.setAccessToken(null);
  },
};

if (typeof window !== "undefined") {
  window.AuthSDK = AuthSDK;
}

export default AuthSDK;
