#!/bin/bash
# bootstrap/docker.sh
# Install Docker CE + Compose plugin.
# Idempotent — skips if already installed.
set -euo pipefail

log() { echo "[docker] $*"; }

# ── Already installed? ─────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
    log "Docker already installed ($(docker --version)). Skipping."
    exit 0
fi

log "Installing Docker CE..."

# ── Add Docker GPG key ─────────────────────────────────────────────────────────
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# ── Add Docker repo ────────────────────────────────────────────────────────────
echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# ── Install ────────────────────────────────────────────────────────────────────
sudo apt-get update -q
sudo apt-get install -y -q \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# ── Add deploy user to docker group ───────────────────────────────────────────
sudo usermod -aG docker "${USER:-deploy}"

# ── Enable service ─────────────────────────────────────────────────────────────
sudo systemctl enable docker --now

log "Docker installed: $(docker --version)"
log "Compose installed: $(docker compose version)"
