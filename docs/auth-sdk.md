# Auth SDK (gateway-hosted)

The browser SDK is a **single static file** served by **api-gateway** at:

`GET /sdk/v1/auth-sdk.js`

There is **no npm package**. Embed it with a normal script tag from any origin:

```html
<script src="https://<your-gateway-host>/sdk/v1/auth-sdk.js"></script>
<script>
  AuthSDK.init({
    gatewayBaseUrl: "https://<your-gateway-host>",
    auth0Domain: "<tenant>.auth0.com",
    auth0ClientId: "<client-id>",
    auth0Audience: "<optional-api-audience>",
    redirectUri: "https://<your-gateway-host>/callback",
  });
</script>
```

## API

| Method | Description |
|--------|-------------|
| `AuthSDK.init(options)` | Required before other calls. `gatewayBaseUrl` must be the **api-gateway** origin (no trailing slash). |
| `AuthSDK.login()` | Opens modal; uses ROPG via `POST /login` on the gateway (proxied to keycloak-api). |
| `AuthSDK.signup()` | Opens modal; `POST /signup` then signs in. |
| `AuthSDK.loginWithAuth0()` | Redirects to Auth0 `/authorize` (configure `auth0*` fields in `init`). |
| `AuthSDK.captureOAuthHash()` | Reads `#access_token=...` after Universal Login redirect; call once on boot. |
| `AuthSDK.getAccessToken()` / `setAccessToken()` | `localStorage` access token for API calls. |
| `AuthSDK.fetchDashboard()` | `GET /me/dashboard` with Bearer token. |
| `AuthSDK.logout()` | Clears stored token. |
| `AuthSDK.getKcPasswordStatus()` | `GET /auth/kc-password-status` with Bearer **Auth0** token (for custom UIs). |
| `AuthSDK.setKcPassword(password, passwordConfirm)` | `POST /auth/kc-password` (Auth0 Bearer). |
| `AuthSDK.isAuth0AccessToken(token)` | Returns true if the JWT issuer looks like Auth0 (same heuristic as enrollment checks). |
| `AuthSDK.promptKcPasswordEnrollment()` | If the stored token is Auth0 and Keycloak reports `needsPassword`, opens the enrollment modal (and a short “syncing” prompt if the KC user is not created yet). Not called automatically on login; the portal banner invokes this on **Set password**. |

**Keycloak-only tokens:** Enrollment checks are skipped when the stored access token was issued by Keycloak (issuer does not contain `auth0.com`), since the user already authenticates against Keycloak.

## CORS

The gateway enables **`Access-Control-Allow-Origin: *`** for API routes used by the SDK (POC). Use **Bearer** tokens in `Authorization`, not cookie credentials, when using `*`.

## Build

From repo root:

```bash
cd auth-sdk && npm install && npm run build
cp -r dist/* ../api-gateway/public/sdk/v1/
```

The **api-gateway** Docker image runs the same build in a multi-stage `Dockerfile`.
