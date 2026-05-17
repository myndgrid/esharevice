#!/usr/bin/env bash
# pg_dump both Postgres instances and upload the encrypted artifacts to Backblaze B2.
#
# Designed to be cron-runnable on the VPS, daily:
#   0 3 * * *  /opt/esharevice/infra/scripts/backup.sh >> /var/log/esharevice-backup.log 2>&1
#
# Requires (installed once at provisioning time):
#   - docker (uses postgres:16-alpine image's pg_dump — no host postgres-client install needed)
#   - rclone configured with a B2 remote named "b2" (see runbook)
#   - age installed for at-rest encryption
#
# Env (read from /etc/esharevice-backup.env, root-only readable):
#   POSTGRES_PASSWORD                 (app DB)
#   AGE_RECIPIENT                     (public age key; private key lives in 1Password)
#   B2_BUCKET                         (e.g. esharevice-backups)
#   RETENTION_DAYS                    (default 30)
#
# Restore drill (run quarterly): /opt/esharevice/infra/scripts/restore-drill.sh

set -Eeuo pipefail
set -o errtrace

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
trap 'log "ERROR at line $LINENO"; exit 1' ERR

# ── env load ───────────────────────────────────────────────
ENV_FILE=${BACKUP_ENV_FILE:-/etc/esharevice-backup.env}
if [[ ! -r "$ENV_FILE" ]]; then
  log "missing env file: $ENV_FILE"
  exit 2
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${POSTGRES_PASSWORD:?required}"
: "${AGE_RECIPIENT:?required}"
: "${B2_BUCKET:?required}"
RETENTION_DAYS=${RETENTION_DAYS:-30}

# ── dirs ───────────────────────────────────────────────────
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORKDIR=$(mktemp -d /tmp/esharevice-backup.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

log "backup start ($STAMP)"

# ── dump app DB ────────────────────────────────────────────
APP_FILE="$WORKDIR/esharevice-app-$STAMP.sql.gz"
log "dumping app DB → $APP_FILE"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i esharevice-postgres-1 \
  pg_dump -U esharevice -d esharevice --no-owner --no-acl --format=plain --compress=0 \
  | gzip -9 > "$APP_FILE"

# ── encrypt at rest with age ───────────────────────────────
for f in "$APP_FILE"; do
  log "encrypting $f"
  age -r "$AGE_RECIPIENT" -o "$f.age" "$f"
  rm -f "$f"
done

# ── upload to B2 ───────────────────────────────────────────
log "uploading to b2:$B2_BUCKET"
rclone copy "$WORKDIR" "b2:$B2_BUCKET/daily/$STAMP" --transfers 2

# ── retention sweep ────────────────────────────────────────
log "pruning backups older than $RETENTION_DAYS days"
rclone delete "b2:$B2_BUCKET/daily" --min-age "${RETENTION_DAYS}d" --rmdirs

log "backup complete"
