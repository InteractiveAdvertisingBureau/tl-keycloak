# Architecture

This POC separates authentication and authorization concerns.

- Keycloak is external and issues JWT tokens.
- API Gateway validates JWT signatures via JWKS.
- AuthZ service owns permissions and dashboard policy.
- Frontend renders only what backend allows in dashboard config.

## Components

- `frontend`: calls gateway endpoints.
- `api-gateway`: authn validation + routing + enforcement hooks.
- `authz-service`: RBAC logic over MySQL.
- `mock-service`: sample proxied admin/user APIs.

## Trust boundaries

- Frontend is untrusted.
- JWT claims are trusted only after cryptographic verification.
- Roles are not taken from JWT; permissions resolved from AuthZ DB.
