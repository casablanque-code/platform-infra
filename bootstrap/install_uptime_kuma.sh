#!/bin/bash
# bootstrap/install_uptime_kuma.sh
# Installs Uptime Kuma — self-hosted uptime monitoring.
# Idempotent — skips if already running.
set -euo pipefail

log() { echo "[uptime-kuma] $*"; }

if docker ps --format '{{.Names}}' | grep -q "^uptime-kuma$"; then
  log "Uptime Kuma already running. Skipping."
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
