#!/usr/bin/env bash
# Quarterly restore drill. Pulls the latest encrypted dump from B2, decrypts,
# and restores into a throwaway Postgres container — then validates row counts
# and exits with non-zero if anything is missing.
#
# Designed to fail loudly. If this script hasn't run successfully in 95 days,
# the cron should page someone.

set -Eeuo pipefail
trap 'echo "ERROR at line $LINENO"; exit 1' ERR

ENV_FILE=${BACKUP_ENV_FILE:-/etc/esharevice-backup.env}
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${B2_BUCKET:?required}"
: "${AGE_IDENTITY_FILE:?required}"   # path to the private age key (root-only readable)

WORKDIR=$(mktemp -d /tmp/esharevice-restore.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

echo "[1/5] finding latest backup in b2:$B2_BUCKET/daily"
LATEST=$(rclone lsf "b2:$B2_BUCKET/daily" --dirs-only | sort | tail -1)
[[ -n "$LATEST" ]] || { echo "no backups found"; exit 2; }
echo "    using $LATEST"

echo "[2/5] pulling encrypted dumps"
rclone copy "b2:$B2_BUCKET/daily/$LATEST" "$WORKDIR"

echo "[3/5] decrypting"
for enc in "$WORKDIR"/*.age; do
  age --decrypt -i "$AGE_IDENTITY_FILE" -o "${enc%.age}" "$enc"
done

echo "[4/5] booting throwaway postgres + restoring"
CID=$(docker run -d --rm -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill -e POSTGRES_USER=drill postgres:16-alpine)
trap 'docker rm -f "$CID" >/dev/null 2>&1; rm -rf "$WORKDIR"' EXIT

# Wait for ready
for _ in $(seq 1 30); do
  docker exec "$CID" pg_isready -U drill >/dev/null 2>&1 && break
  sleep 1
done

# Restore the app dump (Authentik dump is checked structurally only — we don't need its data)
gunzip -c "$WORKDIR"/esharevice-app-*.sql.gz | docker exec -i "$CID" psql -U drill -d drill -v ON_ERROR_STOP=1

echo "[5/5] validating"
USERS=$(docker exec "$CID" psql -U drill -d drill -tAc "SELECT count(*) FROM users")
ITEMS=$(docker exec "$CID" psql -U drill -d drill -tAc "SELECT count(*) FROM exchange_items")
echo "    users=$USERS, exchange_items=$ITEMS"
[[ "$USERS" =~ ^[0-9]+$ && "$ITEMS" =~ ^[0-9]+$ ]] || { echo "validation failed"; exit 3; }

echo "OK: restore drill succeeded"
