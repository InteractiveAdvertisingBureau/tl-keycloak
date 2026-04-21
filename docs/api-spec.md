# API Specification

## API Gateway

### `GET /health`
- Returns gateway health.

### `GET /callback`
- Public. Auth0 redirect target: `?code=` or `?error=`.
- Exchanges `code` at Auth0 `/oauth/token` (requires `AUTH0_CLIENT_SECRET`).
- Redirects to `FRONTEND_URL#access_token=...` (POC).

### `POST /login`
- Public. Body: `{ "username": "string", "password": "string" }`.
- Response: Keycloak token response (includes `access_token`, `refresh_token`, etc.).

### `POST /signup`
- Public. Body: `{ "username": "string", "email": "string", "password": "string" }`.
- Response: `{ "message": "User created successfully" }`.

### `GET /me/dashboard`
- Auth: Bearer JWT required.
- Flow: validates JWT then calls `GET /authz/dashboard/:userId`.
- Response: dashboard config (`features`, `menu`).

### `POST /admin/create-user`
- Auth: Bearer JWT required.
- Flow: gateway calls `POST /authz/check` with `action=CREATE_USER`.
- Responses:
  - `200` success mock payload
  - `403` forbidden

### `/admin/*`, `/user/*`
- Auth: Bearer JWT required.
- Behavior: proxied to mock-service with user context headers.

## AuthZ Service

### `POST /authz/check`
Request:
```json
{ "userId": "string", "action": "string" }
```
Response:
```json
{ "allowed": true }
```

### `GET /authz/permissions/:userId`
Response:
```json
{ "permissions": ["VIEW_USER", "CREATE_USER"] }
```

### `GET /authz/dashboard/:userId`
Response:
```json
{
  "features": { "users": { "view": true, "create": false } },
  "menu": [
    { "name": "Dashboard", "visible": true },
    { "name": "Users", "visible": true }
  ]
}
```
