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
# cms and api in place and wait for both to be healthy, then prove the new
# profile works before any visitor sees it. After the swap it checks the public
# site through Caddy and TLS, and only then records the pins as last good.
set -euo pipefail

readonly PROFILE_TAG=${1:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}
readonly CMS_TAG=${2:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}
readonly API_TAG=${3:?usage: deploy.sh <profile-tag> <cms-tag> <api-tag>}

# shellcheck source=lib.sh
source /opt/mbs/lib.sh
# A copy of images.env, taken only once a deploy has passed every check below.
# images.env itself is rewritten before anything is proven, so after a failure
# this is the only record of what last worked.
readonly LAST_GOOD_FILE=$ROOT/images.last-good.env
readonly PROJECT=mbs-prod
readonly NETWORK=${PROJECT}_default
readonly CANDIDATE=mbs-deploy-candidate
readonly REGISTRY=ghcr.io/mbs-samarinda

# Every host the site answers on, and one page of each other kind on one school.
# The layout reads different CMS rows than these pages do, so a `/`-only check
# would let a schema drift on any of them through.
readonly OWNER_HOSTS=(smp sma smk)
readonly OTHER_PAGES=(/profil /program /fasilitas /ekstrakurikuler /artikel /pendaftaran /kontak)

log() { printf '\n== %s\n' "$*"; }

# True when the page's <html> element carries this owner. Matched on <html> only:
# article pages render other owners' data-owner in their badges, so a match
# anywhere in the body could pass on the wrong host.
owned_by() {
  local html="<html[^>]*[[:space:]]data-owner=\"$2\""
  [[ $1 =~ $html ]]
}

cleanup_candidate() {
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
}

# Set once images.env holds this deploy's untested pins. Before that, a failure
# changed nothing worth restoring.
pinned=false
# Set when the migrate step starts, since a failed run may still have applied
# some of its migrations. Drizzle only migrates forward.
migrated=false

# Per run, not a fixed /tmp name: a file left by another user (a deploy run
# under sudo) cannot be overwritten, and every probe would then fail.
probe_err=$(mktemp)

on_exit() {
  local status=$?
  cleanup_candidate
  rm -f "$probe_err"
  ((status != 0)) && $pinned || return "$status"
  if [[ -f $LAST_GOOD_FILE ]]; then
    local tags
    # shellcheck disable=SC1090
    tags=$(source "$LAST_GOOD_FILE" && echo "${PROFILE_IMAGE##*:} ${CMS_IMAGE##*:} ${API_IMAGE##*:}")
    # A redeploy rather than a copy of the file: by now cms, api or profile may
    # already run the new images, and pins that disagree with them would let the
    # next `compose up` swap images with no checks at all.
    {
      echo
      echo "$IMAGES_FILE now pins images that did not pass. To put the last good ones back:"
      echo "  $ROOT/deploy.sh $tags"
      echo "The workflow logs the box out of ghcr.io after every run, so if a pull is denied, docker login ghcr.io first."
      echo "Not past a commit that added a CMS component; that destroys its content. Roll forward instead."
    } >&2
  else
    echo "No deploy has passed since $LAST_GOOD_FILE was introduced, so there are no older pins to restore." >&2
  fi
  if $migrated; then
    {
      echo "Core migrations ran in this run, and redeploying older images cannot undo them. If one applied,"
      echo "an older api runs against the new schema: compare drizzle.__drizzle_migrations in mbs_core with"
      echo "packages/db/drizzle/meta/_journal.json at the last good commit. The full rollback also"
      echo "restores $backup_dir/mbs_core-$stamp.dump."
    } >&2
  fi
  return "$status"
}
trap on_exit EXIT

# ---------------------------------------------------------------------------

log "Checking $ENV_FILE"
# lib.sh has read it. compose enforces its own `${VAR:?}` guards when it parses
# this file, but the candidate below is a plain `docker run`, which does no interpolation and no
# such check. A variable missing from the file would reach the candidate unset,
# and an unset PROFILE_APEX is not an error — it is a 404 on every host, which
# reads as a failed smoke check rather than as a misconfigured box. So they are
# asserted here, once, before anything starts.
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
pinned=true

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
# Left behind when a dump dies under set -e, before the empty-file check below
# can remove it. Cleared here so re-running after a crash does not pile them up.
find "$backup_dir" -name '.*.dump.part' -delete
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
migrated=true
docker run --rm --network "$NETWORK" \
  -w /app/packages/db \
  -e "DATABASE_URL=postgres://mbs:$POSTGRES_PASSWORD@postgres:5432/mbs_core" \
  "$REGISTRY/mbs-api:$API_TAG" node_modules/.bin/drizzle-kit migrate

log "Starting cms and api"
# Postgres is already up from the backup step above.
# --wait: the candidate below is a plain `docker run` that skips depends_on, so
# without it a new cms image is still booting when the smoke check runs. The
# 7-minute cap covers the cms healthcheck's full budget (90s start + 30 × 10s),
# so a cms stuck in a restart loop fails the deploy instead of hanging it. The
# api's healthcheck gives up far sooner, within 140s (20s start + 12 × 10s).
if ! timeout 7m "${COMPOSE[@]}" up -d --wait cms api; then
  echo "The new cms or api did not become healthy. Both now run (or restart) on the new images," >&2
  echo "and the old profile keeps serving against them." >&2
  exit 1
fi

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

# Waits for a target to answer at all before judging what it answers.
#
# Both `docker run -d` and `compose up -d` return as soon as the container is
# created, and a Next.js server needs a second or two to listen. The first
# failed run probed the candidate 200ms after starting it; the next probed the
# swapped-in container 290ms after, and got `Connection refused`. Same bug, two
# places — so this takes the target as an argument and both use it.
wait_for() {
  local target=$1 deadline=$((SECONDS + 60))
  while ((SECONDS < deadline)); do
    # Matched positively on an HTTP status line, not negatively on one error
    # string. `grep -qv 'Connection refused'` looked right and was not: an
    # unresolvable host produces different text, so anything that was not
    # refused — including a name that does not exist — counted as ready.
    #
    # Any status counts, including 500. This waits for a listener; whether the
    # answer is correct is the probes' business, below.
    if "${COMPOSE[@]}" exec -T "$PROBE_SVC" sh -c \
      "wget -S -q -O /dev/null --spider 'http://$target:3002/' 2>&1 | grep -q 'HTTP/'" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "$target never started listening within 60s." >&2
  return 1
}

probe() {
  local target=$1 host=$2 path=$3 owner=$4 body err
  # stderr is captured rather than discarded. Losing it is how "caddy is not
  # running" came back as "did not return 200".
  if ! body=$("${COMPOSE[@]}" exec -T "$PROBE_SVC" \
    wget -q -O - --header "Host: $host" "http://$target:3002$path" 2>"$probe_err"); then
    err=$(tr -d '\r' < "$probe_err" | tail -2 | tr '\n' ' ')
    echo "  FAIL $host$path — ${err:-no response}" >&2
    return 1
  fi
  # A 200 whose <html> carries another owner's key would mean the proxy resolved
  # the wrong site — the one failure that must never ship. Only checked on `/`,
  # since that is where every owner is probed.
  if [[ $path == / ]] && ! owned_by "$body" "$owner"; then
    echo "  FAIL $host$path answered without <html data-owner=\"$owner\">" >&2
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
if ! wait_for "$CANDIDATE"; then
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

# `up -d` with no service, not `up -d profile`. Caddy depends_on profile, and
# compose starts a service's dependencies, never its dependents — so naming
# profile alone left Caddy permanently unstarted and the site unreachable from
# outside the box, with every internal probe still passing.
"${COMPOSE[@]}" up -d

log "Waiting for the live container"
if ! wait_for profile; then
  echo "The swapped-in profile never started listening." >&2
  exit 1
fi

log "Verifying the live container"
# The new container inherits the candidate's cache through the shared volume, so
# these are a check that the swap worked rather than a warm-up. They stay
# because the swap is the one step nothing else verifies.
if ! smoke profile; then
  echo "The deployed profile is not answering." >&2
  exit 1
fi

log "Checking the public site through Caddy and TLS"
# Every probe above talks to profile:3002 inside the compose network, so a
# stopped caddy or a missing certificate passes them. This one
# goes the way a visitor does: port 443 on this host, real certificate check.
# --resolve pins the name to this box, so it tests this box and not whatever DNS
# says. Retried for 90s because a first deploy is still fetching certificates.
# No -L: a redirect would answer without the marker, and that should fail.
public_probe() {
  local host=$1 owner=$2 deadline=$((SECONDS + 90)) body reason
  while ((SECONDS < deadline)); do
    if body=$(curl -fsS --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/" 2>"$probe_err"); then
      if owned_by "$body" "$owner"; then
        echo "  ok   https://$host/"
        return 0
      fi
      reason="answered without <html data-owner=\"$owner\">"
    else
      reason=$(tail -1 "$probe_err")
    fi
    sleep 3
  done
  echo "  FAIL https://$host/ — $reason" >&2
  return 1
}

public_smoke() {
  local owner
  public_probe "$PROFILE_APEX" mbs || return 1
  for owner in "${OWNER_HOSTS[@]}"; do
    public_probe "$owner.$PROFILE_APEX" "$owner" || return 1
  done
}
if ! public_smoke; then
  echo "The new profile is live but visitors cannot reach it through Caddy." >&2
  exit 1
fi

deployed=$(docker inspect --format '{{.Config.Image}}' "$PROJECT-profile-1")
log "Deployed $deployed"
[[ $deployed == *":$PROFILE_TAG" ]] || {
  echo "Running image is $deployed, expected tag $PROFILE_TAG" >&2
  exit 1
}

# Last, so it only ever names images that passed everything above. Written to a
# temporary name and renamed, so a crash mid-write cannot leave half a file.
cp "$IMAGES_FILE" "$LAST_GOOD_FILE.tmp"
mv "$LAST_GOOD_FILE.tmp" "$LAST_GOOD_FILE"
log "Recorded $LAST_GOOD_FILE"
