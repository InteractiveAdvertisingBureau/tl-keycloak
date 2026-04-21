# Authorization Model

Authorization is centralized in `authz-service`.

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
