#!/bin/bash
# bootstrap/install_node_exporter.sh
# Installs Prometheus Node Exporter for system metrics.
# Idempotent — skips if already installed.
set -euo pipefail

log() { echo "[node-exporter] $*"; }

NODE_EXPORTER_VERSION="1.8.1"

if command -v node_exporter &>/dev/null || systemctl is-active --quiet node_exporter 2>/dev/null; then
  log "Node Exporter already installed. Skipping."
  exit 0
fi

log "Downloading Node Exporter v${NODE_EXPORTER_VERSION}..."
cd /tmp
curl -fsSL "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" \
  | tar xz

sudo mv "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter" /usr/local/bin/
rm -rf "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64"

log "Creating systemd service..."
sudo tee /etc/systemd/system/node_exporter.service > /dev/null << 'EOF'
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
User=nobody
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable node_exporter --now

log "Node Exporter running on :9100/metrics"

# TODO: restrict port 9100 to monitoring server IP only
# sudo ufw allow from MONITORING_IP to any port 9100
