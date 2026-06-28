#!/bin/bash
# bootstrap/install_pgadmin.sh
# Installs pgAdmin 4 in Docker — web UI for PostgreSQL.
# Requires: db_password env var or reads from deployment outputs.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[pgadmin] $*"; }

# Brings up (or confirms) the Zero Trust tunnel for this service. Safe to
# call every run — `zt up` is itself idempotent. No-ops quietly if cfzt
# isn't configured on this node.
expose_via_cfzt() {
  if ! command -v zt &>/dev/null || [ ! -f ~/.zt-config.json ]; then
    log "cfzt not configured on this node — skipping tunnel, falling back to direct access"
    return 0
  fi
  log "Exposing pgAdmin via Cloudflare Zero Trust..."
  zt up pgadmin 5050 || log "zt up failed — pgAdmin is running but not tunneled, check 'zt doctor'"
}

if docker ps --format '{{.Names}}' | grep -q "^pgadmin$"; then
  log "pgAdmin already running. Skipping."
  expose_via_cfzt
  exit 0
fi

PGADMIN_EMAIL="${PGADMIN_EMAIL:-admin@platform.local}"
PGADMIN_PASSWORD="${PGADMIN_PASSWORD:-$(openssl rand -hex 12)}"

log "Starting pgAdmin 4..."
docker run -d \
  --name pgadmin \
  --restart=always \
  -p 5050:80 \
  -e PGADMIN_DEFAULT_EMAIL="$PGADMIN_EMAIL" \
  -e PGADMIN_DEFAULT_PASSWORD="$PGADMIN_PASSWORD" \
  -v pgadmin_data:/var/lib/pgadmin \
  dpage/pgadmin4:latest

log "pgAdmin available at http://<PUBLIC_IP>:5050"
log "Login: $PGADMIN_EMAIL / $PGADMIN_PASSWORD"

# Persist credentials to control plane so they survive past the GitHub Actions
# log (which expires after 90 days). pgadmin_password is in SENSITIVE_KEYS so
# it gets encrypted at rest in D1.
if [ -n "${CONTROL_PLANE_URL:-}" ] && [ -n "${CALLBACK_TOKEN:-}" ] && [ -n "${ENVIRONMENT_ID:-}" ]; then
  log "Saving pgAdmin credentials to control plane..."
  curl -sf -X POST "${CONTROL_PLANE_URL}/api/environments/${ENVIRONMENT_ID}/service-outputs" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CALLBACK_TOKEN}" \
    -d "{\"pgadmin_email\":\"${PGADMIN_EMAIL}\",\"pgadmin_password\":\"${PGADMIN_PASSWORD}\"}" \
  && log "Credentials saved." \
  || log "WARNING: failed to save credentials to control plane -- note them from this log"
fi

expose_via_cfzt
