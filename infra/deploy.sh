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
# The three image pins, in their own file rather than passed inline.
#
# compose interpolates the WHOLE file on every command, not just `up` — so with
# these exported for one command only, a plain `compose exec postgres pg_dump`
# fails with "required variable API_IMAGE is missing a value". That is the
# backup step below, and the probe step, and every compose call in backup.sh.
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

for required in PROFILE_APEX CMS_URL MEDIA_BASE_URL REVALIDATE_SECRET POSTGRES_PASSWORD CMS_DB_PASSWORD; do
  if [[ -z ${!required:-} ]]; then
    echo "$ENV_FILE is missing $required" >&2
    exit 1
  fi
done

log "Pinning $IMAGES_FILE"
# Written before any compose command runs, for the reason above.
cat > "$IMAGES_FILE" <<PINS
# Written by deploy.sh on every deploy. Do not edit by hand.
PROFILE_IMAGE=$REGISTRY/mbs-profile:$PROFILE_TAG
CMS_IMAGE=$REGISTRY/mbs-cms:$CMS_TAG
API_IMAGE=$REGISTRY/mbs-api:$API_TAG
PINS

log "Pulling images"
docker pull -q "$REGISTRY/mbs-profile:$PROFILE_TAG"
docker pull -q "$REGISTRY/mbs-cms:$CMS_TAG"
docker pull -q "$REGISTRY/mbs-api:$API_TAG"

log "Starting Postgres"
# Before the backup, not after. On a first deploy nothing is running at all, so
# `compose exec postgres` fails with `service "postgres" is not running` — which
# is how the third deploy attempt failed. Every local rehearsal started from a
# stack that was already up, so the script only ever handled a steady-state
# deploy and never a cold start.
#
# --wait blocks until the healthcheck passes, so the dump below cannot race the
# socket appearing. On a first deploy this is also what runs
# init-cms-db.sh and creates mbs_cms, so both databases exist by the time they
# are dumped.
"${COMPOSE[@]}" up -d --wait postgres

log "Backing up both databases"
# Local and pre-deploy: this is the copy that lets a bad migration be undone in
# the next ten minutes. The nightly off-box backup is slice 6 and a different
# job with a different retention.
#
# On a first deploy these dump a freshly initialised empty database. That is
# small and useless but correct, and it is cheaper than special-casing.
backup_dir=$ROOT/backups
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for db in mbs_core mbs_cms; do
  # Written to a .part name and renamed only once it has content. The shell
  # creates a redirect target before the command runs, so a failed pg_dump left
  # a zero-byte file named exactly like a backup — which the fortnight prune
  # then kept, looking legitimate. pg_dump -Fc always writes a header, so empty
  # means it never ran. The leading dot keeps the part file out of the *.dump
  # glob the prune uses.
  part=$backup_dir/.$db-$stamp.dump.part
  "${COMPOSE[@]}" exec -T postgres pg_dump -U mbs -Fc "$db" > "$part"
  if [[ ! -s $part ]]; then
    echo "pg_dump wrote nothing for $db; refusing to leave an empty dump" >&2
    rm -f "$part"
    exit 1
  fi
  mv "$part" "$backup_dir/$db-$stamp.dump"
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
# Postgres is already up from the backup step above.
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
  -e "MEDIA_BASE_URL=$MEDIA_BASE_URL" \
  -e API_BASE_URL=http://api:3001 \
  -e "REVALIDATE_SECRET=$REVALIDATE_SECRET" \
  -e PROFILE_CACHE_DIR=/app/.cache/content \
  --mount "type=volume,source=${PROJECT}_content-cache,target=/app/.cache/content" \
  "$REGISTRY/mbs-profile:$PROFILE_TAG" >/dev/null
# 500, higher than every compose service. If the box runs out of memory while
# two profiles are alive, the one nobody is using yet is what the kernel takes.

# wget from the POSTGRES container, not caddy. Caddy is started after the smoke
# check passes, so on a first deploy `compose exec caddy` fails with `service
# "caddy" is not running` — and because the old version sent stderr to
# /dev/null, that was reported as "did not return 200". A misleading message on
# the one mechanism the deploy safety story rests on.
#
# postgres:18-alpine carries busybox wget and is the first container up, so it
# is available for every probe by construction. The node-based images have
# neither curl nor wget.
readonly PROBE_SVC=postgres

# Waits for the candidate to answer at all before judging what it answers.
# `docker run -d` returns as soon as the container is created, and a Next.js
# server needs a second or two to listen — the first failed run probed 200ms
# after starting it, so "did not return 200" meant "was not up yet".
wait_for_candidate() {
  local deadline=$((SECONDS + 60))
  while ((SECONDS < deadline)); do
    if "${COMPOSE[@]}" exec -T "$PROBE_SVC" \
      wget -q -O /dev/null --spider "http://$CANDIDATE:3002/" 2>/dev/null; then
      return 0
    fi
    # A 500 still means it is listening, which is all this waits for; the probes
    # below are what decide whether the answer is right.
    if "${COMPOSE[@]}" exec -T "$PROBE_SVC" \
      sh -c "wget -q -O /dev/null --spider 'http://$CANDIDATE:3002/' 2>&1 | grep -q 'server returned error'" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "Candidate never started listening within 60s." >&2
  return 1
}

probe() {
  local target=$1 host=$2 path=$3 owner=$4 body err
  # stderr is captured rather than discarded. Losing it is how "caddy is not
  # running" came back as "did not return 200".
  if ! body=$("${COMPOSE[@]}" exec -T "$PROBE_SVC" \
    wget -q -O - --header "Host: $host" "http://$target:3002$path" 2>/tmp/probe.err); then
    err=$(tr -d '\r' < /tmp/probe.err | tail -2 | tr '\n' ' ')
    echo "  FAIL $host$path — ${err:-no response}" >&2
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

log "Waiting for the candidate to listen"
if ! wait_for_candidate; then
  echo "The running profile was not touched." >&2
  exit 1
fi

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

"${COMPOSE[@]}" up -d profile

log "Verifying the live container"
# The new container inherits the candidate's cache through the shared volume, so
# these are a check that the swap worked rather than a warm-up. They stay
# because the swap is the one step nothing else verifies.
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
