#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# All config (Auth0, Cloud SQL, URLs, Keycloak admin) comes from repo-root `.env` on the VM.
docker compose --env-file .env pull --ignore-buildable 2>/dev/null || true
docker compose --env-file .env up -d --build --remove-orphans
docker compose --env-file .env ps
