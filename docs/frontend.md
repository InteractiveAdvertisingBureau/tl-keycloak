# Frontend Behavior

## Environment

- `VITE_API_BASE_URL` — API gateway (e.g. `http://localhost:4010` with default Docker `GATEWAY_HOST_PORT`) for `/me/dashboard`, `/admin/*`, etc.
- `VITE_AUTH_API_URL` — auth service for `POST /login` and `POST /signup` only (often same host/port as the gateway).

## Authentication

- `/login` — username/password; calls `POST ${VITE_AUTH_API_URL}/login`; on success stores Keycloak `access_token` in `localStorage` (`access_token`).
- `/signup` — calls `POST ${VITE_AUTH_API_URL}/signup`; then user can sign in.

## After login

- Call `GET /me/dashboard` through API Gateway with the Bearer token.
- Render pages and actions from `features` and `menu`.

## Routing

- `/login`, `/signup` — public
- `/` — Dashboard (requires token; redirects to `/login` if missing)
- `/users` — visible only when `features.users.view=true`
- `/unauthorized` — denied states

## Security notes

- Frontend visibility does not grant access.
- Backend still enforces permissions for actions.
