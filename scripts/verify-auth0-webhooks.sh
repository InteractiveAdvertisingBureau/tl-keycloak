#!/usr/bin/env bash
# Verify api-gateway → keycloak-api Auth0 Action webhook paths (requires stack running).
# Usage:
#   ./scripts/verify-auth0-webhooks.sh
#   GATEWAY_URL=https://your-tunnel.example.com AUTH0_ACTIONS_SECRET=... ./scripts/verify-auth0-webhooks.sh

set -euo pipefail

BASE="${GATEWAY_URL:-http://localhost:4010}"
SECRET="${AUTH0_ACTIONS_SECRET:-changeme-actions}"

if ! curl -sfS "${BASE}/health" >/dev/null; then
  echo "Gateway not reachable at ${BASE}/health — start the stack (e.g. docker compose up) and retry."
  exit 2
fi

code_pre=$(curl -sS -o /tmp/tl-pre.json -w "%{http_code}" -X POST "${BASE}/webhooks/auth0/pre-user-registration" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET}" \
  -d '{"user":{"email":"verify-webhook-pre@example.com"}}')

if [[ "${code_pre}" != "200" ]]; then
  echo "pre-user-registration expected 200, got ${code_pre}: $(cat /tmp/tl-pre.json)"
  exit 1
fi

code_reg=$(curl -sS -o /tmp/tl-reg.json -w "%{http_code}" -X POST "${BASE}/webhooks/auth0/post-user-registration" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET}" \
  -d '{"user":{"sub":"auth0|verify-webhook-reg","email":"verify-webhook-reg@example.com","email_verified":true}}')

if [[ "${code_reg}" != "200" ]]; then
  echo "post-user-registration expected 200, got ${code_reg}: $(cat /tmp/tl-reg.json)"
  exit 1
fi

code_post=$(curl -sS -o /tmp/tl-post.json -w "%{http_code}" -X POST "${BASE}/webhooks/auth0/post-login" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET}" \
  -d '{"user":{"sub":"auth0|verify-webhook-user","email":"verify-webhook-post@example.com","email_verified":true}}')

if [[ "${code_post}" != "200" ]]; then
  echo "post-login expected 200, got ${code_post}: $(cat /tmp/tl-post.json)"
  exit 1
fi

echo "OK: gateway webhooks reachable (pre + post-registration + post-login)."
echo "post-login body: $(cat /tmp/tl-post.json)"
exit 0
