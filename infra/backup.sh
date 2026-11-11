#!/usr/bin/env bash
# One night's backup: both databases, encrypted, off the VPS.
#
# Installed by infra/install-backup-cron.sh and run from cron. Also safe to run
# by hand — it names every object by timestamp, so nothing is overwritten.
#
# The dump is piped straight through age into the upload. Nothing unencrypted
# ever touches the disk, and a 58 GB box never has to hold a copy.
#
# `docs/11` is blunt about what counts as evidence here: "A restore drill — not a
# successful backup command — is evidence that recovery works." See
# infra/restore-drill.sh, and read the warning in it about where the key lives.
set -euo pipefail

# shellcheck source=lib.sh
source /opt/mbs/lib.sh
require_images_file

# The public half of the age key, and only the public half. The box can encrypt
# with this and cannot decrypt anything — which is the whole point: the previous
# iteration's backups are unrecoverable because the only copy of its private key
# sat on the machine the backups existed to survive.
: "${BACKUP_AGE_RECIPIENT:?$ENV_FILE needs BACKUP_AGE_RECIPIENT (age public key)}"
: "${BACKUP_BUCKET:?$ENV_FILE needs BACKUP_BUCKET}"
: "${AWS_ENDPOINT:?$ENV_FILE needs AWS_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?$ENV_FILE needs AWS_ACCESS_KEY_ID}"
: "${AWS_ACCESS_SECRET:?$ENV_FILE needs AWS_ACCESS_SECRET}"
use_aws

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
readonly STAMP

# Tells an outside monitor how the night went, if BACKUP_PING_URL is set. A
# monitor that hears nothing alerts too, which covers the failures that happen
# before this point. The URL works like a password, so it is never printed and
# reaches curl on stdin rather than as an argument anyone can read in `ps`.
# A ping that fails only warns, so the monitor can never fail a good backup.
ping_monitor() {
  [[ -n ${BACKUP_PING_URL:-} ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null -K - <<<"url = \"${BACKUP_PING_URL%/}$1\"" ||
    echo "   could not reach the backup monitor" >&2
}
on_exit() {
  local status=$?
  ((status == 0)) || ping_monitor /fail
  return "$status"
}
trap on_exit EXIT

for db in mbs_core mbs_cms; do
  # The naming scheme the previous job used. Its dumps are ciphertext nobody can
  # open, but the convention was right, so it is kept: one object per database
  # per run, sorted by name because the timestamp is ISO 8601.
  object="s3://$BACKUP_BUCKET/$db-$STAMP.dump.age"
  echo "== $db -> $object"

  # -Fc, so a restore can be selective rather than depending on psql replaying a
  # whole script.
  if "${COMPOSE[@]}" exec -T postgres pg_dump -U mbs -Fc "$db" \
    | age -r "$BACKUP_AGE_RECIPIENT" \
    | aws --endpoint-url "$AWS_ENDPOINT" s3 cp - "$object"; then
    echo "   ok"
  else
    # pipefail fails the run but cannot un-upload. `aws s3 cp -` streams
    # whatever it is handed, so a pg_dump that dies mid-stream leaves a
    # truncated object — and it sorts newest, which is exactly the one
    # restore-drill.sh reaches for by default. An earlier comment here claimed
    # pipefail prevented that; it does not.
    #
    # Taken from the previous iteration's infra/backup/backup.sh, which got this
    # right and said so: "aws uploads whatever it was handed, so a failed
    # pg_dump still leaves an object behind".
    echo "   FAILED — removing the partial object" >&2
    aws --endpoint-url "$AWS_ENDPOINT" s3 rm "$object" >/dev/null 2>&1 || true
    exit 1
  fi
done

# Retention. Without it the bucket grows forever, and the bill with it.
readonly KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
cutoff=$(date -u -d "$KEEP_DAYS days ago" +%Y-%m-%d)
echo "== pruning backups older than $cutoff"

# Deliberately strict, because this deletes objects and `mbss-ppdb` in the same
# account holds real applicant PII. Nothing is removed unless its name is
# exactly a dump this script produces, so a mis-set BACKUP_BUCKET deletes
# nothing rather than something irreplaceable. The five `mbss-<ISO>Z.dump.age`
# objects from the previous iteration do not match either — they are
# unrecoverable ciphertext and removing them is a deliberate, separate act.
readonly NAME_RE='^(mbs_core|mbs_cms)-([0-9]{4}-[0-9]{2}-[0-9]{2})T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\.dump\.age$'

aws --endpoint-url "$AWS_ENDPOINT" s3 ls "s3://$BACKUP_BUCKET/" \
  | awk '{print $4}' \
  | grep -E "$NAME_RE" \
  | while read -r name; do
    # Not a ${name%%...} trim: the database prefix contains a hyphen of its own,
    # so the date has to be matched rather than cut at the first separator.
    day=$(sed -E "s/$NAME_RE/\\2/" <<<"$name")
    # Lexicographic comparison, which is what ISO 8601 dates are for.
    if [[ $day < $cutoff ]]; then
      echo "   rm $name"
      aws --endpoint-url "$AWS_ENDPOINT" s3 rm "s3://$BACKUP_BUCKET/$name"
    fi
  done

ping_monitor ""
echo "== done $STAMP"
