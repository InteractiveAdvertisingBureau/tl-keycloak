/**
 * Auth0 Actions — copy ONE block at a time into the Auth0 Dashboard.
 *
 * For each Action:
 * 1. Actions → Library → Build Custom → pick the matching trigger.
 * 2. Settings → Action secrets:
 *    - BACKEND_URL  = public **api-gateway** origin (HTTPS; tunnel for local dev), no trailing slash
 *    - ACTIONS_SECRET = same value as AUTH0_ACTIONS_SECRET on keycloak-api (gateway forwards Authorization)
 * 3. Paste only the code under that trigger’s section (from exports… through the closing };
 * 4. Add to the correct Flow and Deploy.
 *
 * Runtime: Node 18 (default in Auth0 Actions).
 */

// =============================================================================
// TRIGGER: Pre User Registration
// Paste everything from the line below through the end of this section’s handler.
// =============================================================================

exports.onExecutePreUserRegistration = async (event, api) => {
  const base = (event.secrets.BACKEND_URL || "").replace(/\/$/, "");
  if (!base || !event.secrets.ACTIONS_SECRET) {
    console.error("auth0-action pre-user-registration: missing BACKEND_URL or ACTIONS_SECRET");
    return;
  }

  const res = await fetch(`${base}/webhooks/auth0/pre-user-registration`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${event.secrets.ACTIONS_SECRET}`,
    },
    body: JSON.stringify({ user: event.user }),
  });

  if (res.status === 503) {
    console.warn("auth0-action pre-user-registration: backend webhook not configured — allowing signup");
    return;
  }

  if (!res.ok) {
    let message = "Registration not allowed";
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch (_) {
      /* ignore */
    }
    api.access.deny(message);
  }
};

// =============================================================================
// TRIGGER: Post User Registration
// Create a NEW Action with this trigger; paste only this handler (not Pre User Registration).
// =============================================================================

exports.onExecutePostUserRegistration = async (event, api) => {
  const base = (event.secrets.BACKEND_URL || "").replace(/\/$/, "");
  if (!base || !event.secrets.ACTIONS_SECRET) {
    console.error("auth0-action post-user-registration: missing BACKEND_URL or ACTIONS_SECRET");
    return;
  }

  try {
    await fetch(`${base}/webhooks/auth0/post-user-registration`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${event.secrets.ACTIONS_SECRET}`,
      },
      body: JSON.stringify({ user: event.user }),
    });
  } catch (err) {
    console.error("auth0-action post-user-registration: webhook request failed", err);
  }
};

// =============================================================================
// TRIGGER: Post Login
// Create a NEW Action with this trigger; paste only this handler.
// =============================================================================

exports.onExecutePostLogin = async (event, api) => {
  const base = (event.secrets.BACKEND_URL || "").replace(/\/$/, "");
  if (!base || !event.secrets.ACTIONS_SECRET) {
    console.error("auth0-action post-login: missing BACKEND_URL or ACTIONS_SECRET");
    return;
  }

  try {
    await fetch(`${base}/webhooks/auth0/post-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${event.secrets.ACTIONS_SECRET}`,
      },
      body: JSON.stringify({ user: event.user }),
    });
  } catch (err) {
    console.error("auth0-action post-login: webhook request failed", err);
  }
};
