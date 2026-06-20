#!/bin/bash
# bootstrap/install_portainer.sh
# Installs Portainer CE — web UI for Docker management.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[portainer] $*"; }

# Brings up (or confirms) the Zero Trust tunnel for this service. Safe to
# call every run — `zt up` is itself idempotent and detects/repairs a stale
# tunnel on Cloudflare's side. No-ops quietly if cfzt isn't configured on
# this node (e.g. CFZT_* secrets weren't set when the platform was deployed).
expose_via_cfzt() {
  if ! command -v zt &>/dev/null || [ ! -f ~/.zt-config.json ]; then
    log "cfzt not configured on this node — skipping tunnel, falling back to direct access"
    return 0
  fi
  log "Exposing Portainer via Cloudflare Zero Trust..."
  zt up portainer 9443 || log "zt up failed — Portainer is running but not tunneled, check 'zt doctor'"
}

if docker ps --format '{{.Names}}' | grep -q "^portainer$"; then
  log "Portainer already running. Skipping."
  expose_via_cfzt
  exit 0
fi

log "Creating Portainer volume..."
docker volume create portainer_data

log "Starting Portainer CE..."
docker run -d \
  --name portainer \
  --restart=always \
  -p 9443:9443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest

log "Portainer available at https://<PUBLIC_IP>:9443"

# TODO: open port 9443 in firewall when real provider is connected
# sudo ufw allow 9443/tcp comment 'Portainer'

expose_via_cfzt
