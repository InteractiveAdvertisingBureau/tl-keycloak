# HLD and LLD

This document reflects how the project is wired today by reading the code in `frontend`, `api-gateway`, `authz-service`, `mock-service`, and the repo docs.

## HLD

```mermaid
flowchart LR
    U["User Browser"] --> FE["Frontend SPA<br/>Vite + React"]

    FE -->|"Auth0 login redirect"| A0["Auth0 Universal Login"]
    FE -->|"Legacy login/signup"| GW["API Gateway<br/>Express"]

    A0 -->|"GET /callback?code=..."| GW
    GW -->|"Code exchange /oauth/token"| A0
    GW -->|"302 redirect with token in URL hash"| FE

    FE -->|"Bearer token<br/>GET /me/dashboard"| GW
    FE -->|"Bearer token<br/>POST /admin/create-user"| GW
    FE -->|"Bearer token<br/>/admin/* and /user/*"| GW

    GW -->|"JWT validation via JWKS"| IDP["Auth0 JWKS or Keycloak JWKS"]
    GW -->|"GET /authz/dashboard/:userId"| AZ["AuthZ Service<br/>Express"]
    GW -->|"POST /authz/check"| AZ
    GW -->|"Proxy with x-user-id/x-user-email"| MS["Mock Service<br/>Express"]

    AZ -->|"Role/permission lookup"| DB["MySQL<br/>RBAC tables"]

    KC["External Keycloak"] -->|"POST /login password grant"| GW
    GW -->|"POST /signup via admin API"| KC

    classDef trust fill:#f7f7f7,stroke:#555,color:#111;
    class FE,GW,AZ,MS,DB,A0,KC,IDP,U trust;
```

### HLD notes

- The frontend is only a presentation layer and token holder. It does not make authorization decisions final.
- The API gateway is the enforcement edge. It handles OAuth callback, legacy Keycloak login/signup, JWT verification, and routing.
- The AuthZ service is the source of truth for roles, permissions, and dashboard feature flags.
- MySQL stores RBAC data only. Credentials stay in Auth0 or Keycloak.
- The mock service behaves like a downstream business API that trusts the gateway to authenticate requests and forward identity headers.

## LLD

```mermaid
flowchart TD
    subgraph Browser["Frontend SPA"]
        M1["main.jsx<br/>consumeOAuthHash()<br/>stores access_token/id_token"]
        A1["App.jsx<br/>route guard + loadDashboard()"]
        L1["Login.jsx / Signup.jsx<br/>Auth0 redirect or API form"]
        API["api.js<br/>getDashboard(), createUser(), login(), signup()"]
        O1["auth0.js<br/>build authorize/logout URLs"]
    end

    subgraph Gateway["api-gateway"]
        G1["src/index.js<br/>mount routes, proxy, base path"]
        G2["middleware/auth.js<br/>decode JWT<br/>resolve issuer/JWKS<br/>verify signature/audience"]
        G3["routes/auth0Callback.js<br/>/callback -> exchange code -> redirect to frontend"]
        G4["routes/auth.js<br/>/login and /signup against Keycloak"]
        G5["routes/me.js<br/>/me/dashboard"]
        G6["/admin/create-user handler<br/>AuthZ check before action"]
        G7["http-proxy-middleware<br/>/admin/* and /user/*"]
    end

    subgraph AuthZ["authz-service"]
        Z1["src/index.js<br/>/authz/check<br/>/authz/permissions/:userId<br/>/authz/dashboard/:userId"]
        Z2["PermissionCache<br/>in-memory TTL cache"]
        Z3["loadPermissions(userId)<br/>JOIN users, user_roles,<br/>role_permissions, permissions"]
        Z4["toDashboardConfig()<br/>maps permissions -> UI features/menu"]
        Z5["db/init.js<br/>schema bootstrap + seed roles/users"]
    end

    subgraph Data["MySQL schema"]
        D1["users"]
        D2["roles"]
        D3["permissions"]
        D4["user_roles"]
        D5["role_permissions"]
    end

    subgraph Providers["Identity providers"]
        P1["Auth0<br/>/authorize + /oauth/token + JWKS"]
        P2["Keycloak<br/>token endpoint + admin users API + JWKS"]
    end

    subgraph Downstream["Business API"]
        S1["mock-service<br/>/admin/health<br/>/user/profile"]
    end

    L1 --> O1
    L1 --> API
    M1 --> A1
    A1 --> API
    API --> G1

    G1 --> G3
    G1 --> G4
    G1 --> G5
    G1 --> G6
    G1 --> G7

    G5 --> G2
    G6 --> G2
    G7 --> G2

    G2 --> P1
    G2 --> P2
    G3 --> P1
    G4 --> P2

    G5 --> Z1
    G6 --> Z1
    Z1 --> Z2
    Z1 --> Z3
    Z1 --> Z4
    Z1 --> Z5

    Z3 --> D1
    Z3 --> D2
    Z3 --> D3
    Z3 --> D4
    Z3 --> D5

    G7 --> S1
```

## Runtime flows

### 1. Auth0 login flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant FE as Frontend
    participant A0 as Auth0
    participant GW as API Gateway
    participant JWKS as JWKS Endpoint
    participant AZ as AuthZ Service
    participant DB as MySQL

    B->>FE: Open /login
    FE->>A0: Redirect to /authorize
    A0->>GW: GET /callback?code=...
    GW->>A0: POST /oauth/token
    A0-->>GW: access_token and/or id_token
    GW-->>B: 302 to FRONTEND_URL#token
    FE->>FE: main.jsx stores token in localStorage
    FE->>GW: GET /me/dashboard with Bearer token
    GW->>JWKS: Fetch signing key by kid
    GW->>GW: Verify issuer, alg, audience
    GW->>AZ: GET /authz/dashboard/:userId
    AZ->>DB: Load permissions
    DB-->>AZ: Roles and permissions
    AZ-->>GW: features + menu
    GW-->>FE: Dashboard config
```

### 2. Protected admin action flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant GW as API Gateway
    participant AZ as AuthZ Service
    participant DB as MySQL
    participant MS as Mock Service

    FE->>GW: POST /admin/create-user with Bearer token
    GW->>GW: authenticateJwt()
    GW->>AZ: POST /authz/check { userId, action: CREATE_USER }
    AZ->>DB: Resolve permissions for userId
    DB-->>AZ: Permission rows
    AZ-->>GW: { allowed: true or false }
    alt allowed
        GW-->>FE: success response
    else forbidden
        GW-->>FE: 403 Forbidden
    end

    FE->>GW: GET /user/profile with Bearer token
    GW->>GW: authenticateJwt()
    GW->>MS: Proxy request with x-user-id and x-user-email
    MS-->>FE: Profile payload
```

## Important implementation detail

- The docs describe AuthZ identity linkage as `users.id = JWT sub`.
- The current gateway code sets `req.user.userId` from `verified.email`, not `verified.sub`, in [api-gateway/src/middleware/auth.js](/Users/dev/Documents/Github/Kodescan/keycloak-poc/api-gateway/src/middleware/auth.js#L209).
- That means the live request path currently asks AuthZ for dashboard and permission data by email-shaped user ID, while the seeded demo data in [authz-service/src/db/init.js](/Users/dev/Documents/Github/Kodescan/keycloak-poc/authz-service/src/db/init.js#L31) uses fixed IDs like `demo-admin-sub`.
- If you want, I can do the next pass and align the implementation with the intended `sub`-based model so the diagrams and code match exactly.
