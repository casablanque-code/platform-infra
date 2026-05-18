#!/bin/bash
# bootstrap/backup_to_r2.sh
# Dumps PostgreSQL database and uploads to Cloudflare R2.
# Requires: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
# Idempotent — each run creates a timestamped backup.
set -euo pipefail

log() { echo "[backup-r2] $*"; }

R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID required}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY required}"
R2_BUCKET="${R2_BUCKET:?R2_BUCKET required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT required}"
DB_NAME="${DB_NAME:-app}"
DB_USER="${DB_USER:-postgres}"
ENVIRONMENT_ID="${ENVIRONMENT_ID:-unknown}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/${DB_NAME}_${TIMESTAMP}.sql.gz"
R2_KEY="backups/${ENVIRONMENT_ID}/${DB_NAME}_${TIMESTAMP}.sql.gz"

# Install aws cli if missing (used for S3-compatible upload)
if ! command -v aws &>/dev/null; then
  log "Installing AWS CLI..."
  sudo apt-get install -y -q awscli
fi

log "Dumping database ${DB_NAME}..."
PGPASSWORD="${DB_PASSWORD:-}" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

log "Uploading to R2: $R2_KEY"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto

rm -f "$BACKUP_FILE"

log "Backup complete: $R2_KEY"

# TODO: add retention policy — delete backups older than 30 days
# TODO: pass R2 credentials via platform secrets when secrets system is ready
