#!/usr/bin/env bash
# Restores the most recent backup of one database into a scratch database and
# reads a row out of it.
#
#   ./restore-drill.sh <mbs_core|mbs_cms> <path-to-age-identity>
#
# Run this on the box, with the identity file brought from wherever it actually
# lives — a password manager — and taken away again afterwards.
#
# READ THIS BEFORE COPYING THE KEY ANYWHERE.
#
# The previous iteration's backup job was not broken. It ran nightly, it
# encrypted, it uploaded, and every run reported success right up to the
# rebuild. It still produced nothing recoverable, because the only copy of its
# key sat on the machine the backups existed to survive. A restore drill would
# have passed too, as long as it ran on that box.
#
# So a drill that uses a key already sitting in /opt/mbs proves the wrong thing.
# It has to use the key as stored off-box. This script refuses an identity file
# under /opt/mbs for exactly that reason.
set -euo pipefail

readonly DB=${1:?usage: restore-drill.sh <mbs_core|mbs_cms> <path-to-age-identity>}
readonly IDENTITY=${2:?usage: restore-drill.sh <mbs_core|mbs_cms> <path-to-age-identity>}

case $DB in
  mbs_core | mbs_cms) ;;
  *)
    echo "Unknown database: $DB" >&2
    exit 1
    ;;
esac

identity_path=$(readlink -f "$IDENTITY")
case $identity_path in
  /opt/mbs/*)
    echo "Refusing: $identity_path is on the box this backup exists to survive." >&2
    echo "Bring the identity from where it is actually stored, and remove it after." >&2
    exit 1
    ;;
esac

readonly ENV_FILE=/opt/mbs/.env
readonly COMPOSE=("docker" "compose" "--env-file" "$ENV_FILE" "-f" "/opt/mbs/compose.prod.yml")
readonly SCRATCH="${DB}_drill"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${BACKUP_BUCKET:?$ENV_FILE needs BACKUP_BUCKET}"
export AWS_SECRET_ACCESS_KEY=$AWS_ACCESS_SECRET
export AWS_DEFAULT_REGION=${AWS_REGION:-idn}

echo "== newest backup of $DB"
# Names carry an ISO 8601 timestamp, so the newest is the last one sorted.
latest=$(aws --endpoint-url "$AWS_ENDPOINT" s3 ls "s3://$BACKUP_BUCKET/" \
  | awk '{print $4}' | grep "^$DB-" | sort | tail -1)
[[ -n $latest ]] || {
  echo "No backup of $DB in $BACKUP_BUCKET" >&2
  exit 1
}
echo "   $latest"

echo "== restoring into $SCRATCH"
# Dropped first so a previous drill cannot make this one look like it worked.
"${COMPOSE[@]}" exec -T postgres psql -U mbs -d postgres \
  -qc "DROP DATABASE IF EXISTS $SCRATCH" -qc "CREATE DATABASE $SCRATCH"

aws --endpoint-url "$AWS_ENDPOINT" s3 cp "s3://$BACKUP_BUCKET/$latest" - \
  | age -d -i "$identity_path" \
  | "${COMPOSE[@]}" exec -T postgres pg_restore -U mbs -d "$SCRATCH" --no-owner

echo "== reading a row back out"
# A restore that reports success and contains nothing is the failure this whole
# script exists to catch, so it ends by counting something real.
case $DB in
  mbs_core)
    "${COMPOSE[@]}" exec -T postgres psql -U mbs -d "$SCRATCH" \
      -c "select key, name from schools order by key"
    ;;
  mbs_cms)
    "${COMPOSE[@]}" exec -T postgres psql -U mbs -d "$SCRATCH" \
      -c "select owner_key, tagline from sites order by owner_key"
    ;;
esac

echo
echo "== dropping $SCRATCH"
"${COMPOSE[@]}" exec -T postgres psql -U mbs -d postgres -qc "DROP DATABASE $SCRATCH"

echo "== drill passed. Remove $identity_path from this machine now."
