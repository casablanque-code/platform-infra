#!/bin/bash
# bootstrap/install_uptime_kuma.sh
# Installs Uptime Kuma — self-hosted uptime monitoring.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[uptime-kuma] $*"; }

# Brings up (or confirms) the Zero Trust tunnel for this service. Safe to
# call every run — `zt up` is itself idempotent. No-ops quietly if cfzt
# isn't configured on this node.
expose_via_cfzt() {
  if ! command -v zt &>/dev/null || [ ! -f ~/.zt-config.json ]; then
    log "cfzt not configured on this node — skipping tunnel, falling back to direct access"
    return 0
  fi
  log "Exposing Uptime Kuma via Cloudflare Zero Trust..."
  zt up uptime-kuma 3001 || log "zt up failed — Uptime Kuma is running but not tunneled, check 'zt doctor'"
}

if docker ps --format '{{.Names}}' | grep -q "^uptime-kuma$"; then
  log "Uptime Kuma already running. Skipping."
  expose_via_cfzt
  exit 0
fi

log "Starting Uptime Kuma..."
docker run -d \
  --name uptime-kuma \
  --restart=always \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  louislam/uptime-kuma:latest

log "Uptime Kuma available at http://<PUBLIC_IP>:3001"

# TODO: open port 3001 in firewall when real provider is connected
# sudo ufw allow 3001/tcp comment 'Uptime Kuma'

expose_via_cfzt
