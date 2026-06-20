#!/bin/bash
# setup.sh — Platform-infra onboarding script
# Reads platform.config.yml and configures Cloudflare Workers + GitHub
#
# Prerequisites:
#   - wrangler CLI: npm i -g wrangler && wrangler login
#   - gh CLI: https://cli.github.com && gh auth login
#   - yq: https://github.com/mikefarah/yq (brew install yq / apt install yq)
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
LIME='\033[1;32m'

log()     { echo -e "${CYAN}→${NC} $*"; }
ok()      { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
err()     { echo -e "${RED}✗${NC} $*"; exit 1; }
header()  { echo -e "\n${LIME}── $* ──${NC}"; }

CONFIG_FILE="${1:-platform.config.yml}"

# ── Checks ────────────────────────────────────────────────────────────────────

header "Checking prerequisites"

[ -f "$CONFIG_FILE" ] || err "Config file not found: $CONFIG_FILE\nCopy platform.config.example.yml to platform.config.yml and fill in values."

command -v wrangler &>/dev/null || err "wrangler not found. Install: npm i -g wrangler"
command -v gh &>/dev/null       || err "gh CLI not found. Install: https://cli.github.com"
command -v yq &>/dev/null       || err "yq not found. Install: brew install yq  OR  snap install yq"

ok "All prerequisites found"

# ── Read config ───────────────────────────────────────────────────────────────

header "Reading configuration"

read_cfg() { yq eval "$1" "$CONFIG_FILE"; }

CF_ACCOUNT_ID=$(read_cfg '.cloudflare.account_id')
CF_D1_ID=$(read_cfg '.cloudflare.d1_database_id')
CF_R2_BUCKET=$(read_cfg '.cloudflare.r2_bucket')
CF_R2_ENDPOINT=$(read_cfg '.cloudflare.r2_endpoint')
CF_R2_KEY_ID=$(read_cfg '.cloudflare.r2_access_key_id')
CF_R2_SECRET=$(read_cfg '.cloudflare.r2_secret_access_key')

GH_OWNER=$(read_cfg '.github.owner')
GH_REPO=$(read_cfg '.github.repo')
GH_TOKEN=$(read_cfg '.github.token')
GH_REF=$(read_cfg '.github.ref')

CALLBACK_TOKEN=$(read_cfg '.secrets.callback_token')
ADMIN_KEY=$(read_cfg '.secrets.admin_key')
ENCRYPTION_KEY=$(read_cfg '.secrets.encryption_key')

SSH_KEY=$(read_cfg '.bootstrap.ssh_private_key')

IONOS_ENABLED=$(read_cfg '.providers.ionos.enabled')
IONOS_IP=$(read_cfg '.providers.ionos.static_ip')
IONOS_USER=$(read_cfg '.providers.ionos.ssh_user')

MOCK_ENABLED=$(read_cfg '.providers.mock.enabled')
MOCK_URL=$(read_cfg '.providers.mock.gateway_url')

CFZT_API_TOKEN=$(read_cfg '.cloudflare_tunnel.api_token')
CFZT_ACCOUNT_ID=$(read_cfg '.cloudflare_tunnel.account_id')
CFZT_DOMAIN=$(read_cfg '.cloudflare_tunnel.domain')

# Validate required fields
[ -n "$CF_D1_ID" ] && [ "$CF_D1_ID" != "null" ] || err "cloudflare.d1_database_id is required"
[ -n "$GH_OWNER" ] && [ "$GH_OWNER" != "null" ]  || err "github.owner is required"
[ -n "$GH_REPO" ]  && [ "$GH_REPO" != "null" ]   || err "github.repo is required"
[ -n "$CALLBACK_TOKEN" ] && [ "$CALLBACK_TOKEN" != "null" ] || err "secrets.callback_token is required"
[ -n "$ADMIN_KEY" ]      && [ "$ADMIN_KEY" != "null" ]      || err "secrets.admin_key is required"
[ -n "$ENCRYPTION_KEY" ] && [ "$ENCRYPTION_KEY" != "null" ] || err "secrets.encryption_key is required"

ok "Configuration loaded"

# ── Update wrangler.jsonc ──────────────────────────────────────────────────────

header "Updating wrangler.jsonc"

WRANGLER_FILE="workers/control-plane/wrangler.jsonc"

cat > "$WRANGLER_FILE" << EOF
{
  "\$schema": "node_modules/wrangler/config-schema.json",
  "name": "platform-control-plane",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-12",

  "triggers": {
    "crons": ["* * * * *"]
  },

  "assets": {
    "directory": "../../apps/dashboard/dist",
    "binding": "ASSETS"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "platform_infra",
      "database_id": "${CF_D1_ID}"
    }
  ],

  "vars": {
    "GITHUB_OWNER": "${GH_OWNER}",
    "GITHUB_REPO": "${GH_REPO}",
    "GITHUB_WORKFLOW": "provision.yml",
    "GITHUB_DESTROY_WORKFLOW": "destroy.yml",
    "GITHUB_ACTION_WORKFLOW": "action.yml",
    "GITHUB_REF": "${GH_REF}"
  }
}
EOF

ok "wrangler.jsonc updated"

# ── Update providers ──────────────────────────────────────────────────────────

header "Updating provider configs"

if [ "$IONOS_ENABLED" = "true" ] && [ -n "$IONOS_IP" ] && [ "$IONOS_IP" != "null" ]; then
  mkdir -p providers/ionos
  cat > providers/ionos/provider.json << EOF
{
  "id": "ionos",
  "runtime": {
    "tfvars": {
      "location": "de",
      "server_type": "vps-m",
      "static_ip": "${IONOS_IP}",
      "ssh_user": "${IONOS_USER}"
    }
  }
}
EOF
  ok "IONOS provider configured (IP: $IONOS_IP)"
fi

if [ "$MOCK_ENABLED" = "true" ] && [ -n "$MOCK_URL" ] && [ "$MOCK_URL" != "null" ]; then
  mkdir -p providers/mock
  cat > providers/mock/provider.json << EOF
{
  "id": "mock",
  "runtime": {
    "tfvars": {
      "gateway_url": "${MOCK_URL}",
      "resource_type": "docker_host",
      "ssh_user": "root"
    }
  }
}
EOF
  ok "Mock provider configured (gateway: $MOCK_URL)"
fi

# ── Set Cloudflare Workers secrets ────────────────────────────────────────────

header "Setting Cloudflare Workers secrets"
log "Setting secrets via wrangler..."

cd workers/control-plane

echo "$CALLBACK_TOKEN"  | wrangler secret put CALLBACK_TOKEN  --name platform-control-plane 2>/dev/null && ok "CALLBACK_TOKEN"
echo "$ADMIN_KEY"       | wrangler secret put ADMIN_KEY       --name platform-control-plane 2>/dev/null && ok "ADMIN_KEY"
echo "$ENCRYPTION_KEY"  | wrangler secret put ENCRYPTION_KEY  --name platform-control-plane 2>/dev/null && ok "ENCRYPTION_KEY"
echo "$GH_TOKEN"        | wrangler secret put GITHUB_TOKEN    --name platform-control-plane 2>/dev/null && ok "GITHUB_TOKEN"

cd ../..

# ── Set GitHub Actions secrets ────────────────────────────────────────────────

header "Setting GitHub Actions secrets"

GH_FULL_REPO="${GH_OWNER}/${GH_REPO}"
log "Setting secrets for $GH_FULL_REPO..."

CONTROL_PLANE_URL="https://platform-control-plane.${CF_ACCOUNT_ID}.workers.dev"
# Try to get actual URL from wrangler if account_id not set
if [ -z "$CF_ACCOUNT_ID" ] || [ "$CF_ACCOUNT_ID" = "null" ]; then
  warn "cloudflare.account_id not set — CONTROL_PLANE_URL will need manual update"
  CONTROL_PLANE_URL="https://platform-control-plane.workers.dev"
fi

gh secret set CALLBACK_TOKEN      --body "$CALLBACK_TOKEN"   --repo "$GH_FULL_REPO" && ok "CALLBACK_TOKEN"
gh secret set CONTROL_PLANE_URL   --body "$CONTROL_PLANE_URL" --repo "$GH_FULL_REPO" && ok "CONTROL_PLANE_URL"
gh secret set R2_ACCESS_KEY_ID    --body "$CF_R2_KEY_ID"     --repo "$GH_FULL_REPO" && ok "R2_ACCESS_KEY_ID"
gh secret set R2_SECRET_ACCESS_KEY --body "$CF_R2_SECRET"    --repo "$GH_FULL_REPO" && ok "R2_SECRET_ACCESS_KEY"
gh secret set R2_BUCKET           --body "$CF_R2_BUCKET"     --repo "$GH_FULL_REPO" && ok "R2_BUCKET"
gh secret set R2_ENDPOINT         --body "$CF_R2_ENDPOINT"   --repo "$GH_FULL_REPO" && ok "R2_ENDPOINT"

if [ -n "$SSH_KEY" ] && [ "$SSH_KEY" != "null" ] && echo "$SSH_KEY" | grep -q "OPENSSH"; then
  gh secret set BOOTSTRAP_SSH_KEY --body "$SSH_KEY" --repo "$GH_FULL_REPO" && ok "BOOTSTRAP_SSH_KEY"
else
  warn "bootstrap.ssh_private_key not set — BOOTSTRAP_SSH_KEY skipped (required for real servers)"
fi

if [ -n "$CFZT_DOMAIN" ] && [ "$CFZT_DOMAIN" != "null" ]; then
  if [ -z "$CFZT_API_TOKEN" ] || [ "$CFZT_API_TOKEN" = "null" ] || [ -z "$CFZT_ACCOUNT_ID" ] || [ "$CFZT_ACCOUNT_ID" = "null" ]; then
    err "cloudflare_tunnel.domain is set but api_token or account_id is missing — fill in all three or leave domain blank to skip cfzt"
  fi
  gh secret set CFZT_API_TOKEN  --body "$CFZT_API_TOKEN"  --repo "$GH_FULL_REPO" && ok "CFZT_API_TOKEN"
  gh secret set CFZT_ACCOUNT_ID --body "$CFZT_ACCOUNT_ID" --repo "$GH_FULL_REPO" && ok "CFZT_ACCOUNT_ID"
  gh secret set CFZT_DOMAIN     --body "$CFZT_DOMAIN"     --repo "$GH_FULL_REPO" && ok "CFZT_DOMAIN"
else
  warn "cloudflare_tunnel.domain not set — cfzt skipped (services will use direct access only)"
fi

if [ "$IONOS_ENABLED" = "true" ] && [ -n "$IONOS_IP" ] && [ "$IONOS_IP" != "null" ]; then
  gh secret set TF_VAR_STATIC_IP  --body "$IONOS_IP"  --repo "$GH_FULL_REPO" && ok "TF_VAR_STATIC_IP"
fi

if [ "$MOCK_ENABLED" = "true" ] && [ -n "$MOCK_URL" ] && [ "$MOCK_URL" != "null" ]; then
  gh secret set TF_VAR_GATEWAY_URL --body "$MOCK_URL" --repo "$GH_FULL_REPO" && ok "TF_VAR_GATEWAY_URL"
fi

# ── Apply D1 migrations ───────────────────────────────────────────────────────

header "Applying D1 migrations"

cd workers/control-plane
log "Running migrations on remote D1..."
wrangler d1 migrations apply platform_infra --remote && ok "Migrations applied"
cd ../..

# ── Deploy ────────────────────────────────────────────────────────────────────

header "Deploying"

log "Building dashboard..."
cd apps/dashboard
npm install --silent
npm run build --silent
cd ../..

log "Deploying Worker..."
cd workers/control-plane
wrangler deploy
cd ../..

ok "Worker deployed"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${LIME}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${LIME}  platform-infra is ready!${NC}"
echo -e "${LIME}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Dashboard: ${CYAN}https://platform-control-plane.workers.dev${NC}"
echo -e "  Login with your ${YELLOW}admin_key${NC} from platform.config.yml"
echo ""
echo -e "  ${GREEN}Next steps:${NC}"
echo -e "  1. Open the dashboard and sign in"
echo -e "  2. Go to Create → select a template"
echo -e "  3. Watch it provision in Deployments tab"
echo ""
