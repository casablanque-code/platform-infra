#!/bin/bash
# bootstrap/checkin.sh
# Registers this node with the platform control plane.
# Called as the last step in post_provision.
# Env vars injected by GitHub Actions via SSH environment or passed as args.
set -euo pipefail

log() { echo "[checkin] $*"; }

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:?CONTROL_PLANE_URL is required}"
CALLBACK_TOKEN="${CALLBACK_TOKEN:?CALLBACK_TOKEN is required}"
ENVIRONMENT_ID="${ENVIRONMENT_ID:?ENVIRONMENT_ID is required}"
AGENT_VERSION="${AGENT_VERSION:-0.1.0}"

HOSTNAME=$(hostname -f 2>/dev/null || hostname)

# Prefer IP injected from tofu outputs (reliable, no network dependency)
# Fall back to ipify if not provided (e.g. manual checkin)
if [ -n "${ENV_PUBLIC_IP:-}" ] && [ "$ENV_PUBLIC_IP" != "203.0.113.10" ]; then
  PUBLIC_IP="$ENV_PUBLIC_IP"
  log "Using IP from tofu outputs: $PUBLIC_IP"
else
  PUBLIC_IP=$(curl -sf --max-time 5 https://api.ipify.org || echo "unknown")
  log "Using IP from ipify: $PUBLIC_IP"
fi

log "Registering node with control plane..."
log "  Environment: $ENVIRONMENT_ID"
log "  Hostname:    $HOSTNAME"
log "  Public IP:   $PUBLIC_IP"

curl -sf -X POST "${CONTROL_PLANE_URL}/api/nodes/checkin" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${CALLBACK_TOKEN}" \
  -d "{
    \"environment_id\": \"${ENVIRONMENT_ID}\",
    \"hostname\": \"${HOSTNAME}\",
    \"public_ip\": \"${PUBLIC_IP}\",
    \"agent_version\": \"${AGENT_VERSION}\"
  }"

log "Node registered successfully."
