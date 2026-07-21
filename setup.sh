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

# ── Read config ───────────────────────────────────────────────────────────────
header "Reading config"
cfg() { yq eval "$1" "$CONFIG_FILE"; }

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

INCUS_ADDR=$(cfg '.incus.remote_addr')
INCUS_TOKEN=$(cfg '.incus.token')

CFZT_API_TOKEN=$(cfg '.cloudflare_tunnel.api_token')
CFZT_ACCOUNT_ID=$(cfg '.cloudflare_tunnel.account_id')
CFZT_DOMAIN=$(cfg '.cloudflare_tunnel.domain')

# Validate required
for VAR_NAME in CF_D1_ID GH_OWNER GH_REPO GH_TOKEN CALLBACK_TOKEN ADMIN_KEY ENCRYPTION_KEY INCUS_ADDR INCUS_TOKEN; do
  VAR_VAL="${!VAR_NAME}"
  [ -n "$VAR_VAL" ] && [ "$VAR_VAL" != "null" ] || err "$VAR_NAME is required — check your platform.config.yml"
done
ok "Config valid"

# ── Cloudflare Workers secrets ────────────────────────────────────────────────
header "Configuring Cloudflare Workers"

cd workers/control-plane
echo "$CALLBACK_TOKEN"  | wrangler secret put CALLBACK_TOKEN        --no-bundle 2>/dev/null && ok "CALLBACK_TOKEN"
echo "$ADMIN_KEY"       | wrangler secret put ADMIN_KEY             --no-bundle 2>/dev/null && ok "ADMIN_KEY"
echo "$ENCRYPTION_KEY"  | wrangler secret put ENCRYPTION_KEY        --no-bundle 2>/dev/null && ok "ENCRYPTION_KEY"
echo "$CF_R2_KEY_ID"    | wrangler secret put R2_ACCESS_KEY_ID      --no-bundle 2>/dev/null && ok "R2_ACCESS_KEY_ID"
echo "$CF_R2_SECRET"    | wrangler secret put R2_SECRET_ACCESS_KEY  --no-bundle 2>/dev/null && ok "R2_SECRET_ACCESS_KEY"
cd ../..

# ── GitHub Actions secrets ────────────────────────────────────────────────────
header "Setting GitHub Actions secrets"

secret() { gh secret set "$1" --body "$2" --repo "$GH_FULL_REPO" && ok "$1" || warn "Failed: $1"; }

# Derive worker URL (may need manual override if using custom domain)
WORKER_URL="https://${GH_REPO//-/}.${CF_ACCOUNT_ID}.workers.dev"

secret CONTROL_PLANE_URL       "$WORKER_URL"
secret CALLBACK_TOKEN          "$CALLBACK_TOKEN"
secret INCUS_REMOTE_ADDR       "$INCUS_ADDR"
secret INCUS_TOKEN             "$INCUS_TOKEN"
secret R2_BUCKET               "$CF_R2_BUCKET"
secret R2_ENDPOINT             "$CF_R2_ENDPOINT"
secret R2_ACCESS_KEY_ID        "$CF_R2_KEY_ID"
secret R2_SECRET_ACCESS_KEY    "$CF_R2_SECRET"
secret GH_OWNER                "$GH_OWNER"
secret GH_REPO                 "$GH_REPO"
secret GH_REF                  "$GH_REF"

if [ -n "$CFZT_DOMAIN" ] && [ "$CFZT_DOMAIN" != "null" ]; then
  [ -n "$CFZT_API_TOKEN" ] && [ "$CFZT_API_TOKEN" != "null" ] || err "cloudflare_tunnel.api_token required when domain is set"
  secret CFZT_API_TOKEN  "$CFZT_API_TOKEN"
  secret CFZT_ACCOUNT_ID "$CFZT_ACCOUNT_ID"
  secret CFZT_DOMAIN     "$CFZT_DOMAIN"
else
  warn "cloudflare_tunnel.domain not set — cfzt skipped (optional)"
fi

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
  echo -e "${LIME}Run this on your Incus server to register the GitHub Actions runner:${NC}"
  echo ""
  cat << RUNNER
  mkdir -p ~/actions-runner && cd ~/actions-runner
  curl -sL https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz | tar xz
  ./config.sh --url https://github.com/${GH_FULL_REPO} --token ${RUNNER_TOKEN} --labels incus-host --unattended
  sudo ./svc.sh install && sudo ./svc.sh start
RUNNER
  echo ""
else
  warn "Could not get runner token. Register manually at:"
  warn "https://github.com/${GH_FULL_REPO}/settings/actions/runners/new"
  warn "Use label: incus-host"
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
