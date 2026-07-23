#!/bin/bash
# bootstrap/base.sh
# Base system hardening and essentials.
# Idempotent — safe to run multiple times.
set -euo pipefail

log() { echo "[base] $*"; }

log "Starting base bootstrap..."

# ── Package update ─────────────────────────────────────────────────────────────
log "Updating packages..."
sudo apt-get update -q
sudo apt-get install -y -q \
    curl wget git unzip htop \
    ca-certificates gnupg lsb-release \
    fail2ban ufw

# ── SSH hardening ──────────────────────────────────────────────────────────────
log "Hardening SSH..."
sudo sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sudo sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# ── Firewall ───────────────────────────────────────────────────────────────────
log "Configuring firewall..."
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw --force enable

# ── fail2ban ───────────────────────────────────────────────────────────────────
log "Starting fail2ban..."
sudo systemctl enable fail2ban --now 2>/dev/null || true

# ── Timezone ───────────────────────────────────────────────────────────────────
log "Setting timezone to UTC..."
sudo timedatectl set-timezone UTC 2>/dev/null || true

log "Base bootstrap complete."
