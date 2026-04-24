# Authorization Model

Authorization is centralized in `authz-service`.

## PDP vs PEP (how this repo uses AuthZ)

- **PDP (Policy Decision Point):** `authz-service` decides **allowed** vs **denied** and returns permission and dashboard data. The **api-gateway** calls it with a server-side user id (for example `POST /authz/check`, `GET /authz/me/:userId`).
- **PEP (Policy Enforcement Point):** The **api-gateway** enforces **JWT validation** and **application routing**, then either calls AuthZ for a decision or proxies to another service after checks.

In this stack, AuthZ is **not** a transparent HTTP proxy for every backend byte stream. If you add full request proxying through AuthZ later, account for **latency**, **payload size**, and **WebSockets** separately from the current JSON check pattern.

See [architecture.md](./architecture.md#authz-pdp-vs-pep-in-this-repository) for edge and routing context.

## Schema

- `users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`

## Linking Keycloak users

Authorization rows use **`users.id` = Keycloak JWT `sub`**, not email. Updating only `email` in `users` does not change which token is authorized.

Set `AUTHZ_ADMIN_SUB` and `AUTHZ_ADMIN_EMAIL` in `authz-service/.env` (or insert/update SQL yourself) so your account’s **`sub`** is assigned the `ADMIN` role. Restart the authz service after changes.

## Rules

- UI visibility is not authorization.
- Every protected action must call AuthZ check server-side.
- `POST /admin/create-user` requires `CREATE_USER` permission.

## Performance

- Permission lookup is cached per user with TTL in memory.
- Cache reduces repeated DB reads.
