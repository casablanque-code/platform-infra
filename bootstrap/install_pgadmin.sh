#!/bin/bash
# bootstrap/install_pgadmin.sh
# Installs pgAdmin 4 in Docker — web UI for PostgreSQL.
# Requires: db_password env var or reads from deployment outputs.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[pgadmin] $*"; }

if docker ps --format '{{.Names}}' | grep -q "^pgadmin$"; then
  log "pgAdmin already running. Skipping."
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

# TODO: open port 5050 in firewall when real provider is connected
# TODO: pass db credentials via CONTROL_PLANE_URL outputs
