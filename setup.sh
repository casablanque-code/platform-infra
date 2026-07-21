#!/bin/bash
# setup.sh — platform-infra onboarding
# Reads platform.config.yml and sets up everything automatically.
#
# Prerequisites:
#   wrangler  — npm i -g wrangler && wrangler login
#   gh        — https://cli.github.com && gh auth login
#   yq        — brew install yq  OR  snap install yq
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m';  NC='\033[0m';       LIME='\033[1;32m'

log()    { echo -e "${CYAN}→${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC} $*"; }
err()    { echo -e "${RED}✗${NC} $*"; exit 1; }
header() { echo -e "\n${LIME}── $* ──${NC}"; }

CONFIG_FILE="${1:-platform.config.yml}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
header "Checking prerequisites"
[ -f "$CONFIG_FILE" ] || err "Config not found: $CONFIG_FILE\nCopy platform.config.example.yml to platform.config.yml and fill in your values."
command -v wrangler &>/dev/null || err "wrangler not found: npm i -g wrangler && wrangler login"
command -v gh       &>/dev/null || err "gh not found: https://cli.github.com"
command -v yq       &>/dev/null || err "yq not found: brew install yq  OR  snap install yq"
ok "Prerequisites ok"

cfg() { yq eval "$1" "$CONFIG_FILE"; }
is_set() { [ -n "$1" ] && [ "$1" != "null" ]; }

# ── Read common config ────────────────────────────────────────────────────────
header "Reading config"

PROVIDER_TYPE=$(cfg '.provider.type')

CF_ACCOUNT_ID=$(cfg '.cloudflare.account_id')
CF_D1_ID=$(cfg '.cloudflare.d1_database_id')
CF_R2_BUCKET=$(cfg '.cloudflare.r2_bucket')
CF_R2_ENDPOINT=$(cfg '.cloudflare.r2_endpoint')
CF_R2_KEY_ID=$(cfg '.cloudflare.r2_access_key_id')
CF_R2_SECRET=$(cfg '.cloudflare.r2_secret_access_key')

GH_OWNER=$(cfg '.github.owner')
GH_REPO=$(cfg '.github.repo')
GH_TOKEN=$(cfg '.github.token')
GH_REF=$(cfg '.github.ref')
GH_FULL_REPO="${GH_OWNER}/${GH_REPO}"

CALLBACK_TOKEN=$(cfg '.secrets.callback_token')
ADMIN_KEY=$(cfg '.secrets.admin_key')
ENCRYPTION_KEY=$(cfg '.secrets.encryption_key')

CFZT_API_TOKEN=$(cfg '.cloudflare_tunnel.api_token')
CFZT_ACCOUNT_ID=$(cfg '.cloudflare_tunnel.account_id')
CFZT_DOMAIN=$(cfg '.cloudflare_tunnel.domain')

for VAR_NAME in PROVIDER_TYPE CF_D1_ID GH_OWNER GH_REPO GH_TOKEN CALLBACK_TOKEN ADMIN_KEY ENCRYPTION_KEY; do
  VAR_VAL="${!VAR_NAME}"
  is_set "$VAR_VAL" || err "$VAR_NAME is required — check your platform.config.yml"
done

case "$PROVIDER_TYPE" in
  incus|proxmox|cloud) ;;
  *) err "provider.type must be one of: incus, proxmox, cloud (got: '$PROVIDER_TYPE')" ;;
esac

ok "Config valid — provider: $PROVIDER_TYPE"

# ── Provider setup ─────────────────────────────────────────────────────────────
# Each function is responsible for:
#   1. Validating/collecting whatever credentials it needs
#   2. Setting provider-specific GitHub secrets
#   3. Printing runner setup instructions (if a self-hosted runner is needed)
#
# All functions must set: RUNNER_LABEL (for provision.yml runs-on matching)

setup_incus() {
  header "Incus setup"

  INCUS_ADDR=$(cfg '.incus.remote_addr')
  INCUS_TOKEN=$(cfg '.incus.token')

  if ! is_set "$INCUS_ADDR"; then
    log "No incus.remote_addr set — installing Incus on this machine..."

    if command -v incus &>/dev/null; then
      ok "Incus already installed ($(incus --version 2>&1 | head -1))"
    else
      if [ "$(id -u)" -ne 0 ] && ! command -v sudo &>/dev/null; then
        err "Need root or sudo to install Incus"
      fi
      SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
      log "Installing Incus via apt..."
      $SUDO apt-get update -qq

      if ! $SUDO apt-get install -y -q incus incus-client 2>/dev/null; then
        warn "incus not in default apt repos (common on Ubuntu <24.04) — adding Zabbly repo..."
        $SUDO mkdir -p /etc/apt/keyrings
        curl -fsSL https://pkgs.zabbly.com/key.asc | $SUDO gpg --dearmor -o /etc/apt/keyrings/zabbly.gpg
        . /etc/os-release
        cat << REPOEOF | $SUDO tee /etc/apt/sources.list.d/zabbly-incus-stable.sources > /dev/null
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${VERSION_CODENAME}
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly.gpg
REPOEOF
        $SUDO apt-get update -qq
        $SUDO apt-get install -y -q incus incus-client \
          || err "Failed to install Incus even after adding the Zabbly repo. Check https://linuxcontainers.org/incus/docs/main/installing/ for your distro."
      fi

      $SUDO usermod -aG incus-admin "$USER" 2>/dev/null || true
      ok "Incus installed ($(incus --version 2>&1 | head -1))"
    fi

    if ! incus info &>/dev/null; then
      log "Initializing Incus (minimal, non-interactive)..."
      SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
      $SUDO incus admin init --minimal
      ok "Incus initialized"
    fi

    log "Enabling Incus API over HTTPS on :8443..."
    SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    $SUDO incus config set core.https_address ":8443"

    log "Generating trust token..."
    INCUS_TOKEN=$($SUDO incus config trust add --name platform --quiet 2>/dev/null \
      || $SUDO incus config trust add --name "platform-$(date +%s)" --quiet)
    INCUS_ADDR="https://127.0.0.1:8443"

    ok "Incus ready at $INCUS_ADDR"
    warn "Using 127.0.0.1 — the self-hosted runner MUST run on this same machine."
  else
    is_set "$INCUS_TOKEN" || err "incus.remote_addr is set but incus.token is missing"
    ok "Using existing Incus at $INCUS_ADDR"
  fi

  secret INCUS_REMOTE_ADDR "$INCUS_ADDR"
  secret INCUS_TOKEN       "$INCUS_TOKEN"

  RUNNER_LABEL="incus-host"
}

setup_proxmox() {
  err "Proxmox support isn't implemented yet. See providers/proxmox/NOTES.md.\nSwitch provider.type to 'incus' for now, or implement Proxmox support first."
}

setup_cloud() {
  err "Cloud provider support isn't implemented yet. See providers/cloud/NOTES.md.\nSwitch provider.type to 'incus' for now, or implement cloud support first."
}

# ── Cloudflare Workers secrets ────────────────────────────────────────────────
header "Configuring Cloudflare Workers"

cd workers/control-plane
echo "$CALLBACK_TOKEN"  | wrangler secret put CALLBACK_TOKEN        --no-bundle 2>/dev/null && ok "CALLBACK_TOKEN"
echo "$ADMIN_KEY"       | wrangler secret put ADMIN_KEY             --no-bundle 2>/dev/null && ok "ADMIN_KEY"
echo "$ENCRYPTION_KEY"  | wrangler secret put ENCRYPTION_KEY        --no-bundle 2>/dev/null && ok "ENCRYPTION_KEY"
echo "$CF_R2_KEY_ID"    | wrangler secret put R2_ACCESS_KEY_ID      --no-bundle 2>/dev/null && ok "R2_ACCESS_KEY_ID"
echo "$CF_R2_SECRET"    | wrangler secret put R2_SECRET_ACCESS_KEY  --no-bundle 2>/dev/null && ok "R2_SECRET_ACCESS_KEY"
cd ../..

# ── GitHub Actions secrets (common) ───────────────────────────────────────────
header "Setting GitHub Actions secrets"

secret() { gh secret set "$1" --body "$2" --repo "$GH_FULL_REPO" && ok "$1" || warn "Failed: $1"; }

WORKER_URL="https://${GH_REPO//-/}.${CF_ACCOUNT_ID}.workers.dev"

secret CONTROL_PLANE_URL    "$WORKER_URL"
secret CALLBACK_TOKEN       "$CALLBACK_TOKEN"
secret R2_BUCKET            "$CF_R2_BUCKET"
secret R2_ENDPOINT          "$CF_R2_ENDPOINT"
secret R2_ACCESS_KEY_ID     "$CF_R2_KEY_ID"
secret R2_SECRET_ACCESS_KEY "$CF_R2_SECRET"
secret GH_OWNER             "$GH_OWNER"
secret GH_REPO              "$GH_REPO"
secret GH_REF               "$GH_REF"

if is_set "$CFZT_DOMAIN"; then
  is_set "$CFZT_API_TOKEN" || err "cloudflare_tunnel.api_token required when domain is set"
  secret CFZT_API_TOKEN  "$CFZT_API_TOKEN"
  secret CFZT_ACCOUNT_ID "$CFZT_ACCOUNT_ID"
  secret CFZT_DOMAIN     "$CFZT_DOMAIN"
else
  warn "cloudflare_tunnel.domain not set — cfzt skipped (optional)"
fi

# ── Provider-specific setup ───────────────────────────────────────────────────
case "$PROVIDER_TYPE" in
  incus)   setup_incus ;;
  proxmox) setup_proxmox ;;
  cloud)   setup_cloud ;;
esac

# ── Deploy Workers ────────────────────────────────────────────────────────────
header "Deploying control plane"
cd workers/control-plane
log "Applying migrations..."
wrangler d1 migrations apply platform_infra --remote
log "Deploying worker..."
wrangler deploy
cd ../..
ok "Control plane deployed"

# ── GitHub Actions runner ─────────────────────────────────────────────────────
header "Self-hosted runner setup"

RUNNER_TOKEN=$(gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "/repos/${GH_FULL_REPO}/actions/runners/registration-token" \
  --jq '.token' 2>/dev/null || echo "")

RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest \
  | grep -oP '(?<="tag_name": "v)[^"]+' || echo "2.317.0")

echo ""
if [ -n "$RUNNER_TOKEN" ]; then
  echo -e "${LIME}Run this on your $PROVIDER_TYPE host to register the GitHub Actions runner:${NC}"
  echo ""
  cat << RUNNER
  mkdir -p ~/actions-runner && cd ~/actions-runner
  curl -sL https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz | tar xz
  ./config.sh --url https://github.com/${GH_FULL_REPO} --token ${RUNNER_TOKEN} --labels ${RUNNER_LABEL} --unattended
  sudo ./svc.sh install && sudo ./svc.sh start
RUNNER
  echo ""
  if [ "$PROVIDER_TYPE" = "incus" ] && [ "$INCUS_ADDR" = "https://127.0.0.1:8443" ]; then
    ok "Since Incus was auto-installed locally, you can run these commands right now, on this machine."
  fi
else
  warn "Could not get runner token. Register manually at:"
  warn "https://github.com/${GH_FULL_REPO}/settings/actions/runners/new"
  warn "Use label: ${RUNNER_LABEL}"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
header "Done"
echo ""
echo -e "  Dashboard → ${LIME}${WORKER_URL}${NC}"
echo -e "  Admin key → ${LIME}${ADMIN_KEY}${NC}"
echo ""
echo "  Next:"
echo "  1. Register the self-hosted runner (commands above)"
echo "  2. Open the dashboard and create your first environment"
echo ""