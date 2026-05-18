#!/bin/bash
# bootstrap/install_portainer.sh
# Installs Portainer CE — web UI for Docker management.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[portainer] $*"; }

if docker ps --format '{{.Names}}' | grep -q "^portainer$"; then
  log "Portainer already running. Skipping."
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
