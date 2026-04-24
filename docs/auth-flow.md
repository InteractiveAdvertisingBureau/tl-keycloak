# Authentication Flow

For **production hostnames** (auth / api / tools / keycloak), **Cloudflare edge**, **gateway Host allowlist**, and how AuthZ fits the PEP/PDP model, see [architecture.md](./architecture.md).

## Auth0 (Universal Login)

1. User clicks **Continue with Auth0** on `/login`.
2. Browser opens Auth0 `/authorize`.
3. Auth0 redirects to the **API gateway** `GET /callback` (or `/kc-poc/callback` when `APP_BASE_PATH=/kc-poc`) with `?code=...`.
4. Gateway exchanges the code at `https://<AUTH0_DOMAIN>/oauth/token` using `AUTH0_CLIENT_SECRET` (confidential client).
5. Gateway redirects the browser to `FRONTEND_URL` with `#access_token=...` (POC transport).
6. `frontend/src/main.jsx` loads the gateway-hosted SDK and calls `captureOAuthHash` (no automatic password modal on load; see **Keycloak password enrollment** below).
7. SPA calls `GET /me/dashboard` with `Authorization: Bearer <access_token>`.
8. Gateway verifies the JWT (Auth0 or Keycloak — see below), resolves **internal user id** via **authz-service** (`/authz/resolve` or `/authz/identities/ensure`), then calls `GET /authz/dashboard/:userId`.

## Fresh Auth0 tenant & Actions

Use this checklist when creating a **new** Auth0 tenant for this repo.

1. **Tenant & application**
   - Create an **Application** suitable for your client: **Single Page Application** if the browser uses PKCE / Universal Login from the frontend; use a **confidential** app (Regular Web) if the gateway exchanges the authorization code with `AUTH0_CLIENT_SECRET` on `GET /callback` (current gateway behavior).
   - Copy **Domain**, **Client ID**, and **Client Secret** into root `.env` / `AUTH0_*` for **api-gateway** and **keycloak-api** (see [`.env.example`](../.env.example)).
2. **API (audience)**
   - **Applications → APIs → Create API**. Set the **Identifier** (this is your **`AUTH0_AUDIENCE`**) — use the same value in the gateway, keycloak-api, and `VITE_AUTH0_AUDIENCE` so access tokens are **JWTs** (not opaque).
3. **URLs**
   - **Allowed Callback URLs:** `<GATEWAY_ORIGIN>/callback` (include `APP_BASE_PATH` prefix if set, e.g. `https://api.example.com/kc-poc/callback`). Must match **`AUTH0_REDIRECT_URI`** / **`VITE_AUTH0_REDIRECT_URI`**.
   - **Allowed Web Origins** and **Allowed Origins (CORS):** your SPA origin (e.g. `http://localhost:4003`).
4. **Grant types (optional)**
   - Enable **Password** / Resource Owner Password only if you still use **`POST /login`** with Auth0 credentials and your tenant policy allows it.
5. **Auth0 Actions (webhooks)**
   - In **Actions → Library**, create **three** custom actions (Node 18), one per trigger: **Pre User Registration**, **Post User Registration**, **Post Login**.
   - Paste the matching handler from [`keycloak-api/auth0-actions/actions-for-auth0-dashboard.js`](../keycloak-api/auth0-actions/actions-for-auth0-dashboard.js) (one export per Action).
   - Under each Action **Settings → Secrets** add:
     - **`BACKEND_URL`** — public **API gateway** origin only (no trailing slash), e.g. `https://api.example.com` or `https://<tunnel>/kc-poc` when `APP_BASE_PATH=/kc-poc`. Auth0 cloud cannot call `http://localhost`; use **ngrok**, **Cloudflare Tunnel**, etc. for local testing.
     - **`ACTIONS_SECRET`** — same random string as **`AUTH0_ACTIONS_SECRET`** on **keycloak-api** (gateway forwards `Authorization: Bearer …` unchanged).
   - Add each Action to the correct **Flow** (Pre User Registration / Post User Registration / Login) and **Deploy**.
6. **Paths called by Actions** (via gateway)

| Trigger | HTTP |
|--------|------|
| Pre User Registration | `POST {BACKEND_URL}/webhooks/auth0/pre-user-registration` |
| Post User Registration | `POST {BACKEND_URL}/webhooks/auth0/post-user-registration` |
| Post Login | `POST {BACKEND_URL}/webhooks/auth0/post-login` |

The gateway proxies these to **keycloak-api**, which syncs users into Keycloak (create if missing; update if already present — see `userSync.service.js`).

**Smoke test (stack running):** `./scripts/verify-auth0-webhooks.sh`

## Email / password (`POST /login` on the gateway)

1. User submits email/username + password through **`AuthSDK.login()`** (modal) or the login page.
2. **keycloak-api** looks up a Keycloak user by email/username.
3. If that user **has** a Keycloak password (credential type `password` or attribute `kc_password_enrolled=true`), the API uses **Keycloak only** — `grant_type=password` against the realm token endpoint with **`KEYCLOAK_ROPG_CLIENT_ID`** — and returns **Keycloak** tokens. **Auth0 is not used** for that request.
4. Otherwise the API uses **Auth0** Resource Owner Password grant (existing behavior).
5. After **Auth0** login, the API ensures an **authz** internal user id, syncs the user to Keycloak (including **`app_user_id`**). **Keycloak password enrollment** is optional and surfaced in the portal UI (next section).
6. After **Keycloak** login, the API links the Keycloak **`sub`** to the same internal id if **`app_user_id`** is present on the Keycloak user.

## Keycloak password enrollment (Auth0 session → Keycloak password)

While migrating off Auth0, users may set a Keycloak-local password while still holding an **Auth0** access token:

1. **`GET /auth/kc-password-status`** (gateway or keycloak-api) with `Authorization: Bearer <Auth0 access_token>` returns `needsPassword`, and when a Keycloak user exists, **`deadlineIso`**, **`daysRemaining`**, and **`deadlinePassed`** (a **30-day** window is started lazily on first status check via the **`kc_password_deadline`** user attribute).
2. On **`/dashboard`** and **`/portal`**, the SPA shows a bottom banner when `needsPassword` is true; **Set password** calls **`AuthSDK.promptKcPasswordEnrollment()`** (modal + optional “syncing” retry if the KC user is not created yet).
3. **`POST /auth/kc-password`** sets the password via Keycloak Admin API and sets **`kc_password_enrolled=true`** (and clears **`kc_password_deadline`**).
4. Later sign-ins can use **email/password** and hit the **Keycloak-first** branch without calling Auth0.

The gateway proxies **`/auth/kc-password-status`**, **`/auth/kc-password`**, and **`/webhooks/auth0/*`** to keycloak-api and rate-limits **`POST /auth/kc-password`**.

## Signup (`POST /signup`)

If the email already exists in Keycloak **and** that account is eligible for Keycloak-only login (password enrolled), signup returns **`409`** with `account_exists_use_keycloak_login` so the client does not create a duplicate Auth0 user.

## JWT validation (gateway)

The gateway inspects JWT **`iss`**:

- **Auth0** (`iss` contains `auth0.com`): JWKS at `https://<tenant>/.well-known/jwks.json`, audience from **`AUTH0_AUDIENCE`** or **`AUTH0_CLIENT_ID`**.
- **Keycloak**: **`KEYCLOAK_JWKS_URI`** (e.g. `http://<kc>/realms/<realm>/protocol/openid-connect/certs`), optional **`KEYCLOAK_AUDIENCE`**.

Configure **both** Auth0 and Keycloak verification when tokens from either IdP can reach **`/me/dashboard`**.

## Internal user id (AuthZ)

Auth0 **`sub`** and Keycloak **`sub`** differ. **authz-service** stores a stable **`users.id`** (UUID) and **`user_identities(issuer, subject, user_id)`**. The gateway resolves the JWT to **`userId`** for **`/authz/*`**.

## Default Docker host ports (4xxx)

- **4010** — API gateway (`GATEWAY_HOST_PORT` → container 3000)
- **4001** — authz-service
- **4002** — mock-service
- **4003** — SPA (`FRONTEND_HOST_PORT` → container 5173). Set **`FRONTEND_URL`** and **`CORS_ORIGIN`** to `http://localhost:4003` (or your public URL).

## Deploying under a path (e.g. `https://api.devjs.in/kc-poc/`)

- Set **`APP_BASE_PATH=/kc-poc`** on the gateway.
- Set **`AUTH0_REDIRECT_URI`** and **`VITE_AUTH0_REDIRECT_URI`** to `https://api.devjs.in/kc-poc/callback` (exact match in Auth0).
- Set **`VITE_API_BASE_URL`** to `https://api.devjs.in/kc-poc` so the browser calls the correct API prefix.
