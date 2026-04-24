# tl-keycloak

Monorepo POC: **Auth0** login (Universal Login + ROPG), **Keycloak** user sync via **keycloak-api**, **api-gateway** with JWT validation and a **hosted Auth SDK**, **authz-service** (MySQL RBAC), and a thin **frontend** SPA.

## Layout

| Package | Role |
|---------|------|
| `auth-sdk` | Builds `auth-sdk.js` (IIFE); copied to `api-gateway/public/sdk/v1/`. |
| `api-gateway` | Static SDK, `/callback`, proxies `/login` `/signup` and **`/webhooks/auth0/*`** to keycloak-api, `/me/dashboard`, admin checks, `/admin/*` `/user/*` → mock. |
| `keycloak-api` | Auth0 signup/login, Keycloak Admin sync, Auth0 Action webhooks. |
| `authz-service` | RBAC + `/authz/dashboard`, `/authz/check`. |
| `mock-service` | Sample downstream API. |
| `frontend` | Vite/React host that loads the SDK from the gateway. |

Each service may have its own **`.env.example`** for running that package outside Compose. **Docker Compose uses a single root `.env` only** (see [`.env.example`](.env.example)) for Auth0, Cloud SQL / DB URLs, Keycloak, and public URLs.

## Ports (default)

| Service | Host port |
|---------|-----------|
| api-gateway | 4010 |
| authz-service | 4001 |
| mock-service | 4002 |
| frontend | 4003 |
| keycloak-api | 4004 |
| Keycloak | 8080 |
| MySQL | 3306 |

## Prerequisites

- Docker / Docker Compose
- **Auth0** application (client ID + secret) with Database Connection; enable **Password** grant if your tenant allows ROPG for testing.
- **Auth0 API** with an **Identifier** equal to **`AUTH0_AUDIENCE`** (so access tokens are JWTs for the gateway).
- Set **`AUTH0_*`**, database, and URL variables in the **root `.env`** before `docker compose up --build`.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env with real AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET

# Local MySQL + Postgres containers (default POC)
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up --build
```

**Cloud SQL / GCP VM:** use only `docker-compose.yml`. Maintain **one** root `.env` on the VM (copy from `.env.example`) with `AUTH0_*`, `KC_DB_URL` / `KC_DB_*` for Postgres, `MYSQL_*` for authz, and public URLs. [`cloudbuild.yaml`](cloudbuild.yaml) only SSHs in, runs `git pull`, and `./scripts/vm-deploy-compose.sh` (it does not create or upload env files).

- Gateway: `http://localhost:4010/health`
- SDK: `http://localhost:4010/sdk/v1/auth-sdk.js`
- SPA: `http://localhost:4003`

### AuthZ and your Auth0 `sub`

Seeded demo users use `auth0|demo-admin-sub` and `auth0|demo-user-sub`. Set **`AUTHZ_ADMIN_SUB`** (and optionally **`AUTHZ_ADMIN_EMAIL`**) in Compose / `authz-service` env to match **your** Auth0 user’s `sub` so `/me/dashboard` resolves.

## Auth0 Actions / webhooks

Auth0 Actions should call the **API gateway** (not keycloak-api directly) so traffic matches production routing:

- `POST <GATEWAY_BASE>/webhooks/auth0/pre-user-registration`
- `POST <GATEWAY_BASE>/webhooks/auth0/post-user-registration`
- `POST <GATEWAY_BASE>/webhooks/auth0/post-login`

Set Action secret **`BACKEND_URL`** to your public gateway origin (no trailing slash; use HTTPS + tunnel for local dev). **`ACTIONS_SECRET`** must equal **`AUTH0_ACTIONS_SECRET`** on **keycloak-api** (gateway forwards the `Authorization` header). Snippets: [keycloak-api/auth0-actions/actions-for-auth0-dashboard.js](keycloak-api/auth0-actions/actions-for-auth0-dashboard.js). Details: [docs/auth-flow.md](docs/auth-flow.md#fresh-auth0-tenant--actions), [docs/keycloak-service-project-doc.md](docs/keycloak-service-project-doc.md).

## SDK embed guide

See [docs/auth-sdk.md](docs/auth-sdk.md).

## Local dev (without full stack)

Install and run services individually using each package’s `package.json` and `.env.example`. Build the SDK and copy artifacts into `api-gateway/public/sdk/v1/` before starting the gateway.

## Documentation

- [docs/api-spec.md](docs/api-spec.md)
- [docs/auth-flow.md](docs/auth-flow.md)
- [docs/authorization.md](docs/authorization.md)
- [docs/keycloak-service-project-doc.md](docs/keycloak-service-project-doc.md) (keycloak-api)
