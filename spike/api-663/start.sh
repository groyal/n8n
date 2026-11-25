#!/usr/bin/env bash
# Starts the mock AGW and an isolated n8n in managed mode. Stop with Ctrl+C.
# Build first: pnpm build > build.log 2>&1
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$KIT/../.." && pwd)"
PORT="${N8N_PORT:-5681}"
MOCK_PORT="${MOCK_AGW_PORT:-4010}"
DATA="$KIT/.data"

if [[ "${1:-}" == "--reset" ]]; then rm -rf "$DATA"; fi
mkdir -p "$DATA"

MOCK_AGW_PORT="$MOCK_PORT" node "$KIT/mock-agw.mjs" &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null' EXIT

cd "$REPO/packages/cli"
N8N_USER_FOLDER="$DATA" \
N8N_PORT="$PORT" \
N8N_RUNNERS_BROKER_PORT="$((PORT + 10))" \
N8N_DIAGNOSTICS_ENABLED=false \
N8N_SECURE_COOKIE=false \
N8N_CUSTOM_EXTENSIONS="$KIT/custom" \
N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi \
N8N_SPIKE_EGRESS_URL="http://127.0.0.1:$MOCK_PORT" \
	pnpm start
