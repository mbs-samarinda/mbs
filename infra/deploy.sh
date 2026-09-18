#!/usr/bin/env bash
# Deploys one release onto the VPS. Run on the box, by the release workflow over
# SSH, with the three image tags as arguments.
#
#   ./deploy.sh <profile-tag> <cms-tag> <api-tag>
#
# The tags are computed on the runner and passed in rather than worked out here.
# They are a hash of turbo's task hash plus the Dockerfile, .dockerignore and
# the lockfile, so reproducing one on the box would mean a checkout, pnpm and
# turbo on a 2 vCPU machine to learn something the runner already knows.
#
# The order is the one docs/11 fixes: pull, back up, migrate exactly once, start
# the services that have no gate, then prove the new profile works before any
# visitor sees it.
set -euo pipefail

readonly PROFILE_TAG=${1:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}
readonly CMS_TAG=${2:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}
readonly API_TAG=${3:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}

readonly ROOT=/opt/mbs
readonly ENV_FILE=$ROOT/.env
readonly COMPOSE=("docker" "compose" "--env-file" "$ENV_FILE" "-f" "$ROOT/compose.prod.yml")
readonly PROJECT=mbs-prod
readonly NETWORK=${PROJECT}_default
readonly CANDIDATE=mbs-deploy-candidate
readonly REGISTRY=ghcr.io/mbs-samarinda

# Every host the site answers on, and one page of each other kind on one school.
# The layout reads different CMS rows than these pages do, so a `/`-only check
# would let a schema drift on any of them through.
readonly OWNER_HOSTS=(smp sma smk)
readonly OTHER_PAGES=(/profil /program /fasilitas /ekstrakurikuler /berita /pendaftaran /kontak)

log() { printf '\n== %s\n' "$*"; }

cleanup_candidate() {
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT

# ---------------------------------------------------------------------------

log "Reading $ENV_FILE"
# compose enforces its own `${VAR:?}` guards when it parses this file, but the
# candidate below is a plain `docker run`, which does no interpolation and no
# such check. A variable missing from the file would reach the candidate unset,
# and an unset PROFILE_APEX is not an error — it is a 404 on every host, which
# reads as a failed smoke check rather than as a misconfigured box. So they are
# asserted here, once, before anything starts.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for required in PROFILE_APEX CMS_URL REVALIDATE_SECRET POSTGRES_PASSWORD CMS_DB_PASSWORD; do
  if [[ -z ${!required:-} ]]; then
    echo "$ENV_FILE is missing $required" >&2
    exit 1
  fi
done

log "Pulling images"
docker pull -q "$REGISTRY/mbs-profile:$PROFILE_TAG"
docker pull -q "$REGISTRY/mbs-cms:$CMS_TAG"
docker pull -q "$REGISTRY/mbs-api:$API_TAG"

log "Backing up both databases"
# Local and pre-deploy: this is the copy that lets a bad migration be undone in
# the next ten minutes. The nightly off-box backup is slice 6 and a different
# job with a different retention.
backup_dir=$ROOT/backups
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for db in mbs_core mbs_cms; do
  "${COMPOSE[@]}" exec -T postgres pg_dump -U mbs -Fc "$db" \
    > "$backup_dir/$db-$stamp.dump"
done
# Keep a fortnight. Without this the 58 GB disk fills quietly.
find "$backup_dir" -name '*.dump' -mtime +14 -delete

log "Running core migrations"
# Once, as a one-shot container, and never on API boot: two API replicas both
# migrating on start is a race, and a failed migration should stop the deploy
# rather than crash-loop a service. Strapi migrates itself.
docker run --rm --network "$NETWORK" \
  -w /app/packages/db \
  -e "DATABASE_URL=postgres://mbs:$POSTGRES_PASSWORD@postgres:5432/mbs_core" \
  "$REGISTRY/mbs-api:$API_TAG" node_modules/.bin/drizzle-kit migrate

log "Starting cms and api"
PROFILE_IMAGE="$REGISTRY/mbs-profile:$PROFILE_TAG" \
  CMS_IMAGE="$REGISTRY/mbs-cms:$CMS_TAG" \
  API_IMAGE="$REGISTRY/mbs-api:$API_TAG" \
  "${COMPOSE[@]}" up -d cms api

# ---------------------------------------------------------------------------
# The gate that used to live in `next build`.
#
# The build no longer reads the CMS, so nothing at build time can tell us the
# Site rows exist and still fit the app's types. `getSite` throws on a missing
# row and a type mismatch surfaces the same way, both as a 500 — so a 200 from
# every probe is the proof, and it is taken here, against the new image, while
# the old container is still the one serving.

log "Starting the candidate"
cleanup_candidate
docker run -d --name "$CANDIDATE" --network "$NETWORK" \
  --oom-score-adj=500 \
  -e NODE_ENV=production \
  -e "PROFILE_APEX=$PROFILE_APEX" \
  -e "CMS_URL=$CMS_URL" \
  -e API_BASE_URL=http://api:3001 \
  -e "REVALIDATE_SECRET=$REVALIDATE_SECRET" \
  "$REGISTRY/mbs-profile:$PROFILE_TAG" >/dev/null
# 500, higher than every compose service. If the box runs out of memory while
# two profiles are alive, the one nobody is using yet is what the kernel takes.

probe() {
  local target=$1 host=$2 path=$3 owner=$4 body
  # wget from the caddy container: it is on this network already and has one,
  # while the node-based images have neither curl nor wget. `-O -` so the body
  # can be checked, not just the status.
  if ! body=$("${COMPOSE[@]}" exec -T caddy \
    wget -q -O - --header "Host: $host" "http://$target:3002$path" 2>/dev/null); then
    echo "  FAIL $host$path did not return 200" >&2
    return 1
  fi
  # A 200 whose <html> carries another owner's key would mean the proxy resolved
  # the wrong site — the one failure that must never ship. Only checked on `/`,
  # since that is where every owner is probed.
  if [[ $path == / && $body != *"data-owner=\"$owner\""* ]]; then
    echo "  FAIL $host$path answered without data-owner=\"$owner\"" >&2
    return 1
  fi
  echo "  ok   $host$path"
}

# Every `|| return 1` is deliberate. This is called as `if ! smoke …`, which
# switches off `set -e` for everything inside it — without them a failing probe
# would print FAIL and the loop would carry on to the next one, and smoke would
# end up reporting whatever the last probe happened to return.
smoke() {
  local target=$1 owner path
  probe "$target" "$PROFILE_APEX" / mbs || return 1
  for owner in "${OWNER_HOSTS[@]}"; do
    probe "$target" "$owner.$PROFILE_APEX" / "$owner" || return 1
  done
  for path in "${OTHER_PAGES[@]}"; do
    probe "$target" "smp.$PROFILE_APEX" "$path" smp || return 1
  done
}

log "Smoke-checking the candidate"
if ! smoke "$CANDIDATE"; then
  echo "Candidate failed its smoke check. The running profile was not touched." >&2
  exit 1
fi

log "Swapping the candidate out and the new image in"
# Removed before the live container starts, not after: both share the content
# cache volume from slice 4 onwards, and only an image that is about to serve
# may write to it.
cleanup_candidate

PROFILE_IMAGE="$REGISTRY/mbs-profile:$PROFILE_TAG" \
  CMS_IMAGE="$REGISTRY/mbs-cms:$CMS_TAG" \
  API_IMAGE="$REGISTRY/mbs-api:$API_TAG" \
  "${COMPOSE[@]}" up -d profile

log "Warming and verifying the live container"
# The swapped-in container starts cold until slice 4 gives the cache a volume,
# so these probes double as the warm-up that spares the first real visitor a
# Strapi round trip. They are also the check that the swap itself worked.
if ! smoke profile; then
  echo "The deployed profile is not answering. Roll forward; do not roll back past a" >&2
  echo "commit that added a CMS component, which would destroy that content." >&2
  exit 1
fi

deployed=$(docker inspect --format '{{.Config.Image}}' "$PROJECT-profile-1")
log "Deployed $deployed"
[[ $deployed == *":$PROFILE_TAG" ]] || {
  echo "Running image is $deployed, expected tag $PROFILE_TAG" >&2
  exit 1
}
