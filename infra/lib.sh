# Shared by deploy.sh, backup.sh and restore-drill.sh. Sourced, never run.
# Sourcing it reads /opt/mbs/.env into the environment.
# shellcheck shell=bash disable=SC2034

readonly ROOT=/opt/mbs
readonly ENV_FILE=$ROOT/.env
# The three image pins, in their own file rather than passed inline.
#
# compose interpolates the WHOLE file on every command, not just `up` — so with
# these exported for one command only, a plain `compose exec postgres pg_dump`
# fails with "required variable API_IMAGE is missing a value". That is the
# deploy's backup and probe steps, and every compose call in backup.sh.
#
# Separate from .env because this file is machine-written on each deploy and
# .env holds hand-placed secrets that nothing should ever rewrite.
readonly IMAGES_FILE=$ROOT/images.env
readonly COMPOSE=(
  "docker" "compose"
  "--env-file" "$ENV_FILE"
  "--env-file" "$IMAGES_FILE"
  "-f" "$ROOT/compose.prod.yml"
)

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# For the scripts that only read the database. deploy.sh writes this file.
require_images_file() {
  [[ -f $IMAGES_FILE ]] || {
    echo "$IMAGES_FILE does not exist yet. deploy.sh writes it; run a deploy first." >&2
    exit 1
  }
}

# Sets what the aws CLI needs to reach the backup bucket.
use_aws() {
  # The aws CLI reads this name, and the rest of the stack calls it
  # AWS_ACCESS_SECRET, so it is bridged here rather than duplicated in the env
  # file where the two could drift.
  export AWS_SECRET_ACCESS_KEY=$AWS_ACCESS_SECRET
  export AWS_DEFAULT_REGION=${AWS_REGION:-idn}

  # aws-cli v2 bundles its own CA store and ignores the system one. Biznet's
  # chain fails that bundle — "self-signed certificate in certificate chain" —
  # while curl on this host and Node's fetch both accept it against
  # /etc/ssl/certs. Measured on Ubuntu 26.04 with aws-cli 2.31.35: without this,
  # every upload fails, so every backup fails.
  #
  # Deliberately not --no-verify-ssl. That would accept any certificate, which
  # on the one channel carrying the database off the box is the wrong trade even
  # though the payload is already encrypted.
  export AWS_CA_BUNDLE=${AWS_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}
}
