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

readonly ENV_FILE=/opt/mbs/.env
# Both env files. compose interpolates the whole compose file on every command,
# not just `up`, so without the image pins even `exec postgres pg_dump` refuses
# to run — which is exactly how an early deploy failed.
readonly IMAGES_FILE=/opt/mbs/images.env
readonly COMPOSE=(
  "docker" "compose"
  "--env-file" "$ENV_FILE"
  "--env-file" "$IMAGES_FILE"
  "-f" "/opt/mbs/compose.prod.yml"
)

[[ -f $IMAGES_FILE ]] || {
  echo "$IMAGES_FILE does not exist yet. deploy.sh writes it; run a deploy first." >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# The public half of the age key, and only the public half. The box can encrypt
# with this and cannot decrypt anything — which is the whole point: the previous
# iteration's backups are unrecoverable because the only copy of its private key
# sat on the machine the backups existed to survive.
: "${BACKUP_AGE_RECIPIENT:?$ENV_FILE needs BACKUP_AGE_RECIPIENT (age public key)}"
: "${BACKUP_BUCKET:?$ENV_FILE needs BACKUP_BUCKET}"
: "${AWS_ENDPOINT:?$ENV_FILE needs AWS_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?$ENV_FILE needs AWS_ACCESS_KEY_ID}"
: "${AWS_ACCESS_SECRET:?$ENV_FILE needs AWS_ACCESS_SECRET}"

# The aws CLI reads this name, and the rest of the stack calls it
# AWS_ACCESS_SECRET, so it is bridged here rather than duplicated in the env
# file where the two could drift.
export AWS_SECRET_ACCESS_KEY=$AWS_ACCESS_SECRET
export AWS_DEFAULT_REGION=${AWS_REGION:-idn}

# aws-cli v2 bundles its own CA store and ignores the system one. Biznet's chain
# fails that bundle — "self-signed certificate in certificate chain" — while
# curl on this host and Node's fetch both accept it against /etc/ssl/certs.
# Measured on Ubuntu 26.04 with aws-cli 2.31.35: without this, every upload
# fails, so every backup fails.
#
# Deliberately not --no-verify-ssl. That would accept any certificate, which on
# the one channel carrying the database off the box is the wrong trade even
# though the payload is already encrypted.
export AWS_CA_BUNDLE=${AWS_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
readonly STAMP

for db in mbs_core mbs_cms; do
  # The naming scheme the previous job used. Its dumps are ciphertext nobody can
  # open, but the convention was right, so it is kept: one object per database
  # per run, sorted by name because the timestamp is ISO 8601.
  object="s3://$BACKUP_BUCKET/$db-$STAMP.dump.age"
  echo "== $db -> $object"

  # -Fc, so a restore can be selective and does not depend on psql replaying a
  # whole script. set -o pipefail above is what makes a pg_dump failure fail the
  # run rather than uploading a truncated, happily-encrypted object.
  "${COMPOSE[@]}" exec -T postgres pg_dump -U mbs -Fc "$db" \
    | age -r "$BACKUP_AGE_RECIPIENT" \
    | aws --endpoint-url "$AWS_ENDPOINT" s3 cp - "$object"
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

echo "== done $STAMP"
