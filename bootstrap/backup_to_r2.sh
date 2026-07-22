#!/bin/bash
# bootstrap/backup_to_r2.sh
# Dumps PostgreSQL database and uploads to Cloudflare R2.
# Credentials are fetched from the control plane at runtime --
# no secrets need to be present on the node in advance.
#
# Requires env vars (set by action.yml from GitHub Secrets):
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
#   CONTROL_PLANE_URL, CALLBACK_TOKEN, ENVIRONMENT_ID
#
# Optional:
#   DB_NAME     (default: app)
#   DB_USER     (default: postgres)
#   RETAIN_DAYS (default: 30)
set -euo pipefail

log()  { echo "[backup-r2] $*"; }
warn() { echo "[backup-r2] WARNING: $*" >&2; }

R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID required}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY required}"
R2_BUCKET="${R2_BUCKET:?R2_BUCKET required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT required}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:?CONTROL_PLANE_URL required}"
CALLBACK_TOKEN="${CALLBACK_TOKEN:?CALLBACK_TOKEN required}"
ENVIRONMENT_ID="${ENVIRONMENT_ID:?ENVIRONMENT_ID required}"

DB_NAME="${DB_NAME:-app}"
DB_USER="${DB_USER:-postgres}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# ── Fetch DB credentials from control plane ──────────────────────────────────
log "Fetching DB credentials from control plane..."
DB_CREDS=$(curl -sf \
  "${CONTROL_PLANE_URL}/api/environments/${ENVIRONMENT_ID}/db-credentials" \
  -H "Authorization: Bearer ${CALLBACK_TOKEN}")

if [ -z "$DB_CREDS" ]; then
  log "No DB credentials found for environment -- skipping backup"
  exit 0
fi

DB_PASSWORD=$(echo "$DB_CREDS" | jq -r '.db_password // empty')
DB_USER=$(echo     "$DB_CREDS" | jq -r ".db_user // \"${DB_USER}\"")
DB_NAME=$(echo     "$DB_CREDS" | jq -r ".db_name // \"${DB_NAME}\"")

if [ -z "$DB_PASSWORD" ]; then
  log "db_password not found in environment outputs -- skipping backup"
  exit 0
fi

# ── Install AWS CLI if missing (S3-compatible client for R2) ─────────────────
if ! command -v aws &>/dev/null; then
  log "Installing AWS CLI..."
  sudo apt-get install -y -q awscli
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/${DB_NAME}_${TIMESTAMP}.sql.gz"
R2_KEY="backups/${ENVIRONMENT_ID}/${DB_NAME}_${TIMESTAMP}.sql.gz"

log "Dumping database '${DB_NAME}' as user '${DB_USER}'..."
PGPASSWORD="${DB_PASSWORD}" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# ── Upload ────────────────────────────────────────────────────────────────────
log "Uploading to R2: s3://${R2_BUCKET}/${R2_KEY}"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto

rm -f "$BACKUP_FILE"
log "Backup complete: ${R2_KEY}"

# ── Retention: delete backups older than RETAIN_DAYS ─────────────────────────
log "Enforcing ${RETAIN_DAYS}-day retention for backups/${ENVIRONMENT_ID}/..."

CUTOFF=$(date -d "${RETAIN_DAYS} days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null \
  || date -v-${RETAIN_DAYS}d +%Y-%m-%dT%H:%M:%S)   # Linux vs macOS

# SIZE is captured because aws s3 ls output is "DATE TIME SIZE KEY" and read
# needs a positional slot for it -- only KEY is actually used below.
# shellcheck disable=SC2034
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 ls "s3://${R2_BUCKET}/backups/${ENVIRONMENT_ID}/" \
  --endpoint-url "$R2_ENDPOINT" --region auto \
  | while read -r DATE TIME SIZE KEY; do
      FILE_DATE="${DATE}T${TIME}"
      if [[ "$FILE_DATE" < "$CUTOFF" ]]; then
        log "Deleting old backup: ${KEY}"
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
        aws s3 rm "s3://${R2_BUCKET}/backups/${ENVIRONMENT_ID}/${KEY}" \
          --endpoint-url "$R2_ENDPOINT" --region auto || warn "Failed to delete ${KEY}"
      fi
    done

log "Retention cleanup done."
