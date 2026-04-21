# tl-keycloak

Monorepo POC: **Auth0** login (Universal Login + ROPG), **Keycloak** user sync via **keycloak-api**, **api-gateway** with JWT validation and a **hosted Auth SDK**, **authz-service** (MySQL RBAC), and a thin **frontend** SPA.

## Layout

| Package | Role |
|---------|------|
| `auth-sdk` | Builds `auth-sdk.js` (IIFE); copied to `api-gateway/public/sdk/v1/`. |
| `api-gateway` | Static SDK, `/callback`, proxies `/login` `/signup` to keycloak-api, `/me/dashboard`, admin checks, `/admin/*` `/user/*` → mock. |
| `keycloak-api` | Auth0 signup/login, Keycloak Admin sync, Auth0 Action webhooks. |
| `authz-service` | RBAC + `/authz/dashboard`, `/authz/check`. |
| `mock-service` | Sample downstream API. |
| `frontend` | Vite/React host that loads the SDK from the gateway. |

Each service has its own **`.env.example`** — copy to **`.env`** for local overrides. Docker Compose injects shared settings via a **root `.env`** (see [`.env.example`](.env.example)).

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
- Set **`AUTH0_*`** in root `.env` before `docker compose up --build`.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env with real AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET

docker compose up --build
```

- Gateway: `http://localhost:4010/health`
- SDK: `http://localhost:4010/sdk/v1/auth-sdk.js`
- SPA: `http://localhost:4003`

### AuthZ and your Auth0 `sub`

Seeded demo users use `auth0|demo-admin-sub` and `auth0|demo-user-sub`. Set **`AUTHZ_ADMIN_SUB`** (and optionally **`AUTHZ_ADMIN_EMAIL`**) in Compose / `authz-service` env to match **your** Auth0 user’s `sub` so `/me/dashboard` resolves.

## Auth0 Actions / webhooks

Point Auth0 Actions at `http://<keycloak-api-host>:4004/webhooks/auth0/...` (use a tunnel for local). Set **`AUTH0_ACTIONS_SECRET`** to match the Action secret. See [docs/keycloak-service-project-doc.md](docs/keycloak-service-project-doc.md).

## SDK embed guide

See [docs/auth-sdk.md](docs/auth-sdk.md).

## Local dev (without full stack)

Install and run services individually using each package’s `package.json` and `.env.example`. Build the SDK and copy artifacts into `api-gateway/public/sdk/v1/` before starting the gateway.

## Documentation

- [docs/api-spec.md](docs/api-spec.md)
- [docs/auth-flow.md](docs/auth-flow.md)
- [docs/authorization.md](docs/authorization.md)
- [docs/keycloak-service-project-doc.md](docs/keycloak-service-project-doc.md) (keycloak-api)
