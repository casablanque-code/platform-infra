#!/bin/bash
# bootstrap/install_cfzt.sh
# Installs cloudflared + cfzt (zt) and configures Cloudflare Zero Trust
# credentials non-interactively.
#
# This only prepares the node — it does NOT bring up any tunnels. Each
# service's own install script (install_portainer.sh etc.) calls
# `zt up <name> <port>` itself once the service is actually running.
#
# Requires env vars (set by provision.yml from platform-level GitHub
# Secrets, not per-environment):
#   CFZT_API_TOKEN   — Cloudflare API token (Tunnel/DNS/Access: Edit)
#   CFZT_ACCOUNT_ID  — Cloudflare account ID
#   CFZT_DOMAIN      — domain on Cloudflare, e.g. example.com
#
# If these aren't set, this script skips entirely rather than failing —
# cfzt is optional infrastructure, not a hard bootstrap dependency.
#
# Idempotent — safe to run multiple times.
set -euo pipefail

log() { echo "[cfzt] $*"; }

CFZT_API_TOKEN="${CFZT_API_TOKEN:-}"
CFZT_ACCOUNT_ID="${CFZT_ACCOUNT_ID:-}"
CFZT_DOMAIN="${CFZT_DOMAIN:-}"

if [ -z "$CFZT_API_TOKEN" ] || [ -z "$CFZT_ACCOUNT_ID" ] || [ -z "$CFZT_DOMAIN" ]; then
  log "CFZT_API_TOKEN / CFZT_ACCOUNT_ID / CFZT_DOMAIN not set — skipping cfzt setup."
  log "Services will fall back to whatever the template's firewall rules allow."
  exit 0
fi

# Everything below is best-effort: a node that fails to get cfzt set up is
# still a fully working node (SSH access and the rest of bootstrap are
# unaffected). Don't let a flaky download or API hiccup here fail the whole
# provisioning run -- log it and move on, services just won't be tunneled
# until someone reruns this script or fixes it manually.
set +e

# ── cloudflared ───────────────────────────────────────────────────────────────

if command -v cloudflared &>/dev/null; then
  log "cloudflared already installed ($(cloudflared --version 2>&1 | head -1)). Skipping."
else
  log "Installing cloudflared..."
  ARCH=$(dpkg --print-architecture)
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  if [ $? -ne 0 ]; then
    log "Failed to download cloudflared — skipping cfzt setup for this run."
    exit 0
  fi
  sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -f -y -q
  rm -f /tmp/cloudflared.deb
  if ! command -v cloudflared &>/dev/null; then
    log "cloudflared install failed — skipping cfzt setup for this run."
    exit 0
  fi
  log "cloudflared installed: $(cloudflared --version 2>&1 | head -1)"
fi

# ── zt (cfzt) ─────────────────────────────────────────────────────────────────

if command -v zt &>/dev/null; then
  log "zt already installed ($(zt --version 2>&1 | head -1)). Skipping install."
else
  log "Installing zt..."
  curl -fsSL https://raw.githubusercontent.com/casablanque-code/cfzt/main/install.sh | bash
  if ! command -v zt &>/dev/null; then
    log "zt install failed — skipping cfzt setup for this run."
    exit 0
  fi
fi

# ── Config ────────────────────────────────────────────────────────────────────
# Writes ~/.zt-config.json directly instead of running `zt init`, which is
# interactive (reads from stdin) and has no flag/env-var equivalent. The
# format is plain JSON, mode 0600 — see casablanque-code/cfzt config/config.go.
log "Writing zt config..."
cat > ~/.zt-config.json << EOF
{
  "api_token": "${CFZT_API_TOKEN}",
  "account_id": "${CFZT_ACCOUNT_ID}",
  "domain": "${CFZT_DOMAIN}"
}
EOF
chmod 600 ~/.zt-config.json

log "Verifying setup with zt doctor..."
# Non-fatal: doctor checks tunnels too, and there are none yet on a fresh
# node. We only care that cloudflared/token/domain checks pass; a full
# failure here shouldn't block the rest of bootstrap.
zt doctor || log "zt doctor reported issues — check token/domain permissions before relying on tunnels"

log "cfzt setup complete."
