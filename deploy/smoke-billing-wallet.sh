#!/bin/bash
# Verify the billing wallet API contract after a server rollout.

set -euo pipefail

SMOKE_BASE_URL="${BILLING_SMOKE_BASE_URL:-${API_URL:-http://localhost:3001}}"
SMOKE_URL="${BILLING_WALLET_SMOKE_URL:-${SMOKE_BASE_URL%/}/api/billing/wallet}"
LOGIN_URL="${BILLING_WALLET_SMOKE_LOGIN_URL:-${SMOKE_BASE_URL%/}/api/auth/login}"
SMOKE_BODY="$(mktemp)"
SMOKE_COOKIES="$(mktemp)"

cleanup() {
  rm -f "${SMOKE_BODY}" "${SMOKE_COOKIES}"
}

trap cleanup EXIT

fail_smoke() {
  local message="$1"
  echo "${message}" >&2
  if [ -s "${SMOKE_BODY}" ]; then
    cat "${SMOKE_BODY}" >&2
  fi
  exit 1
}

check_authenticated_wallet() {
  local status
  status="$(curl -sS -o "${SMOKE_BODY}" -w "%{http_code}" "$@" "${SMOKE_URL}" || true)"

  if [ "${status}" != "200" ]; then
    fail_smoke "Billing wallet authenticated smoke failed for ${SMOKE_URL}: expected 200, got ${status}"
  fi

  if ! grep -q '"success"[[:space:]]*:[[:space:]]*true' "${SMOKE_BODY}" ||
     ! grep -q '"account"[[:space:]]*:' "${SMOKE_BODY}"; then
    fail_smoke "Billing wallet authenticated smoke returned an unexpected response shape for ${SMOKE_URL}"
  fi
}

if [ -n "${BILLING_WALLET_SMOKE_TOKEN:-}" ]; then
  check_authenticated_wallet -H "Authorization: Bearer ${BILLING_WALLET_SMOKE_TOKEN}"
  echo "Billing wallet authenticated smoke passed for ${SMOKE_URL}"
  exit 0
fi

if [ -n "${BILLING_WALLET_SMOKE_EMAIL:-}" ] && [ -n "${BILLING_WALLET_SMOKE_PASSWORD:-}" ]; then
  LOGIN_PAYLOAD="$(
    node -e 'console.log(JSON.stringify({ email: process.env.BILLING_WALLET_SMOKE_EMAIL, password: process.env.BILLING_WALLET_SMOKE_PASSWORD }))'
  )"
  LOGIN_STATUS="$(
    curl -sS -o "${SMOKE_BODY}" -w "%{http_code}" -c "${SMOKE_COOKIES}" \
      -H "Content-Type: application/json" \
      -d "${LOGIN_PAYLOAD}" \
      "${LOGIN_URL}" || true
  )"

  if [ "${LOGIN_STATUS}" != "200" ]; then
    fail_smoke "Billing wallet smoke login failed for ${LOGIN_URL}: expected 200, got ${LOGIN_STATUS}"
  fi

  check_authenticated_wallet -b "${SMOKE_COOKIES}"
  echo "Billing wallet authenticated smoke passed for ${SMOKE_URL}"
  exit 0
fi

SMOKE_STATUS="$(curl -sS -o "${SMOKE_BODY}" -w "%{http_code}" "${SMOKE_URL}" || true)"

if [ "${SMOKE_STATUS}" != "401" ]; then
  fail_smoke "Billing wallet unauthenticated smoke failed for ${SMOKE_URL}: expected 401, got ${SMOKE_STATUS}"
fi

echo "Billing wallet unauthenticated smoke passed for ${SMOKE_URL}"
echo "Set BILLING_WALLET_SMOKE_TOKEN or BILLING_WALLET_SMOKE_EMAIL/PASSWORD to verify the authenticated wallet response shape."
