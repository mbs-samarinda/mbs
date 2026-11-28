#!/usr/bin/env bash
# Deploys one release onto the VPS. Run on the box, by the release workflow over
# SSH, with the five image tags as arguments.
#
#   ./deploy.sh <profile-tag> <cms-tag> <api-tag> <admission-tag> <admin-tag>
#
# `-` in place of both app tags leaves the two PPDB apps exactly as they are and
# checks nothing about them. It is the way back to a release from before they
# existed, when they are what is broken.
#
# The tags are computed on the runner and passed in rather than worked out here.
# They are a hash of turbo's task hash plus the Dockerfile, .dockerignore and
# the lockfile, so reproducing one on the box would mean a checkout, pnpm and
# turbo on a 2 vCPU machine to learn something the runner already knows.
#
# Old images go first, to make room. After that the order is the one the
# knowledge repo's docs/deployment.md fixes: pull,
# back up, migrate exactly once, start cms, api and the two PPDB apps in place and
# wait for all four to be healthy, then prove the new profile works before any visitor sees it.
# After the swap it checks the public site through Caddy and TLS, and only then
# records the pins as last good.
set -euo pipefail

readonly USAGE="usage: deploy.sh <profile-tag> <cms-tag> <api-tag> <admission-tag> <admin-tag>"
readonly PROFILE_TAG=${1:?$USAGE}
readonly CMS_TAG=${2:?$USAGE}
readonly API_TAG=${3:?$USAGE}
readonly ADMISSION_TAG=${4:?$USAGE}
readonly ADMIN_TAG=${5:?$USAGE}
# The apps this run deploys.
apps=(admission admin)
if [[ $ADMISSION_TAG == - || $ADMIN_TAG == - ]]; then
  [[ $ADMISSION_TAG == "$ADMIN_TAG" ]] || { echo "$USAGE (or - for both apps)" >&2; exit 2; }
  apps=()
fi
readonly apps

# shellcheck source=lib.sh
source /opt/mbs/lib.sh
# The pins of images.env, taken only once a deploy has passed every check below.
# images.env itself is rewritten before anything is proven, so after a failure
# this is the only record of what last worked.
readonly LAST_GOOD_FILE=$ROOT/images.last-good.env
# One line of images for every deploy that passed, oldest first. A line holds three
# images when that deploy left the two PPDB apps alone or came before them.
readonly HISTORY_FILE=$ROOT/images.history
readonly KEEP_RELEASES=4
readonly PROJECT=mbs-prod
readonly NETWORK=${PROJECT}_default
readonly CANDIDATE=mbs-deploy-candidate
readonly REGISTRY=ghcr.io/mbs-samarinda
release="$REGISTRY/mbs-profile:$PROFILE_TAG $REGISTRY/mbs-cms:$CMS_TAG $REGISTRY/mbs-api:$API_TAG"
((${#apps[@]} == 0)) || release+=" $REGISTRY/mbs-admission:$ADMISSION_TAG $REGISTRY/mbs-admin:$ADMIN_TAG"
readonly RELEASE=$release

# Every host the site answers on, and one page of each other kind on one school.
# The layout reads different CMS rows than these pages do, so a `/`-only check
# would let a schema drift on any of them through.
readonly OWNER_HOSTS=(smp sma smk)
readonly OTHER_PAGES=(/profil /program /fasilitas /ekstrakurikuler /artikel /pendaftaran /kontak)

# One deploy at a time. CI runs one, but a rollback is typed by hand, and the
# image cleanup could remove what the other deploy just pulled. The folder is
# locked, not a lock file, which a run under sudo would own.
exec 9< "$ROOT"
flock -w 1200 9 || {
  echo "Another deploy has been running for 20 minutes. Nothing was deployed; run this one again." >&2
  exit 1
}

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
    # A last good file that names no apps leaves them as they are.
    # shellcheck disable=SC1090
    tags=$(
      ADMISSION_IMAGE=- ADMIN_IMAGE=-
      source "$LAST_GOOD_FILE" \
        && echo "${PROFILE_IMAGE##*:} ${CMS_IMAGE##*:} ${API_IMAGE##*:} ${ADMISSION_IMAGE##*:} ${ADMIN_IMAGE##*:}"
    )
    # A redeploy rather than a copy of the file: by now cms, api or profile may
    # already run the new images, and pins that disagree with them would let the
    # next `compose up` swap images with no checks at all.
    {
      echo
      echo "$IMAGES_FILE now pins images that did not pass. To put the last good ones back:"
      echo "  $ROOT/deploy.sh $tags"
      if [[ $tags != *" - -" ]]; then
        echo "Or, when the two PPDB apps are what fails, leave them as they are:"
        echo "  $ROOT/deploy.sh ${tags% * *} - -"
      fi
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
# lib.sh has already sourced $ENV_FILE. compose enforces its own `${VAR:?}`
# guards when it parses that file, but the candidate below is a plain
# `docker run`, which does no interpolation and no such check. A variable
# missing from the file would reach the candidate unset, and an unset
# PROFILE_APEX is not an error — it is a 404 on every host, which reads as a
# failed smoke check rather than as a misconfigured box. So they are asserted
# here, once, before anything starts.
for required in PROFILE_APEX CMS_URL MEDIA_BASE_URL REVALIDATE_SECRET CMS_READ_TOKEN PREVIEW_SECRET POSTGRES_PASSWORD CMS_DB_PASSWORD CMS_HOST CADDY_EMAIL SMTP_URL MAIL_FROM S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  if [[ -z ${!required:-} ]]; then
    echo "$ENV_FILE is missing $required" >&2
    exit 1
  fi
done

# Both apps put S3_ENDPOINT in their Content-Security-Policy. A CSP source with
# a path matches that path and nothing under it, so an endpoint carrying one
# would pass every check here and then block every upload in the browser. Only
# when this run deploys the apps: the way back leaves them alone.
if ((${#apps[@]} > 0)) && [[ ! $S3_ENDPOINT =~ ^https?://[^/]+/?$ ]]; then
  echo "S3_ENDPOINT must be a bare origin such as https://nos.jkt-1.neo.id, not $S3_ENDPOINT" >&2
  echo "The apps' Content-Security-Policy uses it as an origin; a path there blocks every upload." >&2
  exit 1
fi

log "Checking the Caddyfile"
# The release unpacks this file into $ROOT before this script runs, and Caddy
# reads it through a single-file bind mount. tar writes a new file rather than
# rewriting the old one, so a running Caddy keeps the old copy, even after
# `caddy reload`, and `compose up` leaves Caddy alone because its compose
# definition did not change. So Caddy is recreated after the swap below when
# the copy it sees differs from the one on disk; a normal deploy never restarts
# it. A Caddy that is not running needs nothing: `compose up` starts it on the
# new file.
#
# Validated again here, before anything changes, with this box's real values.
# The release already validated it before copying it, so a failure here is
# rare. When it happens the broken file cannot be kept off the disk from here:
# it is already where Caddy will read it on its next restart.
readonly CADDY_REVERT="It is already in $ROOT, and Caddy loads it on its next restart. Revert the Caddyfile change and release again; redeploying older image tags does not touch it."
if ! "$ROOT/validate-caddyfile.sh" "$ROOT"; then
  echo "The Caddyfile is invalid, so nothing was deployed. $CADDY_REVERT" >&2
  exit 1
fi
caddy_stale=false
if docker exec "$PROJECT-caddy-1" true 2>/dev/null &&
  ! docker exec "$PROJECT-caddy-1" cat /etc/caddy/Caddyfile | cmp -s - "$ROOT/Caddyfile"; then
  caddy_stale=true
fi

log "Removing old images"
# Postgres shares this disk, and each release adds up to 1.7 GB. What stays is
# the last KEEP_RELEASES releases that passed and the one being deployed, so
# images that only ever failed go first. Nothing goes until that many have passed.
# Before the pull, so failed deploys do not pile up. Docker refuses to remove an
# image a container uses, since this never forces it. Never fails the deploy.
remove_old_images() {
  local -A keep=() release_seen=()
  local -a history=()
  local i line app image images status
  if [[ -f $HISTORY_FILE ]]; then mapfile -t history < "$HISTORY_FILE" || return 1; fi
  for ((i = ${#history[@]} - 1; i >= 0 && ${#release_seen[@]} < KEEP_RELEASES; i--)); do
    line=${history[i]}
    [[ -n $line ]] || continue
    release_seen[$line]=1
    for image in $line; do keep[$image]=1; done
  done
  if ((${#release_seen[@]} < KEEP_RELEASES)); then
    echo "  ${#release_seen[@]} of $KEEP_RELEASES releases recorded, keeping everything"
    return 0
  fi
  # The rollback that on_exit names, in case its history line was never written.
  images=
  if [[ -f $LAST_GOOD_FILE ]]; then
    # shellcheck disable=SC1090
    images=$(source "$LAST_GOOD_FILE" && echo "$PROFILE_IMAGE $CMS_IMAGE $API_IMAGE ${ADMISSION_IMAGE:-} ${ADMIN_IMAGE:-}") || return 1
  fi
  for image in $RELEASE $images; do keep[$image]=1; done
  for app in profile cms api admission admin; do
    if ! images=$(timeout 60 docker image ls "$REGISTRY/mbs-$app" \
      --format '{{if eq .Tag "<none>"}}{{.ID}}{{else}}{{.Repository}}:{{.Tag}}{{end}}'); then
      echo "  could not list mbs-$app images" >&2
      continue
    fi
    for image in $images; do
      [[ -z ${keep[$image]:-} ]] || continue
      status=0
      timeout 60 docker rmi "$image" >/dev/null || status=$?
      if ((status == 124)); then
        echo "  $image took over a minute, leaving the rest for the next deploy" >&2
        return 0
      elif ((status != 0)); then
        echo "  kept $image, docker would not remove it" >&2
      else
        echo "  removed $image"
      fi
    done
  done
}
remove_old_images || echo "Could not remove old images." >&2

log "Pinning $IMAGES_FILE"
# Written before any compose command runs: compose interpolates the whole file
# on every command, so every one of them needs these pins (see lib.sh).
app_pins=$(grep -E '^(ADMISSION|ADMIN)_IMAGE=' "$IMAGES_FILE" 2>/dev/null || true)
[[ -z $app_pins ]] || app_pins+=$'\n'
cat > "$IMAGES_FILE" <<PINS
# Written by deploy.sh on every deploy. Do not edit by hand.
PROFILE_IMAGE=$REGISTRY/mbs-profile:$PROFILE_TAG
CMS_IMAGE=$REGISTRY/mbs-cms:$CMS_TAG
API_IMAGE=$REGISTRY/mbs-api:$API_TAG
PINS
if ((${#apps[@]} > 0)); then
  cat >> "$IMAGES_FILE" <<PINS
ADMISSION_IMAGE=$REGISTRY/mbs-admission:$ADMISSION_TAG
ADMIN_IMAGE=$REGISTRY/mbs-admin:$ADMIN_TAG
PINS
else
  printf '%s' "$app_pins" >> "$IMAGES_FILE"
fi
pinned=true

log "Pulling images"
docker pull -q "$REGISTRY/mbs-profile:$PROFILE_TAG"
docker pull -q "$REGISTRY/mbs-cms:$CMS_TAG"
docker pull -q "$REGISTRY/mbs-api:$API_TAG"
if ((${#apps[@]} > 0)); then
  docker pull -q "$REGISTRY/mbs-admission:$ADMISSION_TAG"
  docker pull -q "$REGISTRY/mbs-admin:$ADMIN_TAG"
fi

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

log "Starting cms, api and the two PPDB apps"
# Postgres is already up from the backup step above.
# --wait: the candidate below is a plain `docker run` that skips depends_on, so
# without it a new cms image is still booting when the smoke check runs. The
# 7-minute cap covers the cms healthcheck's full budget (90s start + 30 × 10s),
# so a cms stuck in a restart loop fails the deploy instead of hanging it. The
# other healthchecks give up far sooner, the api's within 140s (20s start + 12 × 10s).
if ! timeout 7m "${COMPOSE[@]}" up -d --wait cms api "${apps[@]}"; then
  echo "One of cms, api, ${apps[*]} did not become healthy. All of them now run (or restart)" >&2
  echo "on the new images, and the old profile keeps serving against them." >&2
  exit 1
fi

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

log "Smoke-checking the two PPDB apps"
# Inside the compose network only, so a host with no DNS record or certificate yet
# cannot fail a deploy.
#
# The last call proves the API answers for the host Caddy will pass on. It picks the
# sign-in by exact host and answers 404 for any other.
app_smoke() {
  local app=$1 body script
  local -a get=("${COMPOSE[@]}" exec -T "$PROBE_SVC" wget -q -O -)
  body=$("${get[@]}" "http://$app:8080/masuk" < /dev/null) || return 1
  [[ $body == *'<div id="root">'* ]] || return 1
  script=$(grep -o '/assets/[^"]*\.js' <<< "$body" | head -1)
  [[ -n $script ]] || return 1
  "${get[@]}" "http://$app:8080$script" < /dev/null > /dev/null || return 1
  "${get[@]}" --header "Host: $app.$PROFILE_APEX" http://api:3001/api/auth/ok < /dev/null > /dev/null || return 1
  echo "  ok   $app.$PROFILE_APEX"
}
for app in "${apps[@]}"; do
  if ! app_smoke "$app"; then
    echo "The new $app app failed its smoke check. The running profile was not touched." >&2
    exit 1
  fi
done

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
  -e "CMS_READ_TOKEN=$CMS_READ_TOKEN" \
  -e "PREVIEW_SECRET=$PREVIEW_SECRET" \
  -e "CMS_HOST=$CMS_HOST" \
  -e PROFILE_CACHE_DIR=/app/.cache/content \
  --mount "type=volume,source=${PROJECT}_content-cache,target=/app/.cache/content" \
  "$REGISTRY/mbs-profile:$PROFILE_TAG" >/dev/null
# 500, higher than every compose service. If the box runs out of memory while
# two profiles are alive, the one nobody is using yet is what the kernel takes.

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
#
# Without the apps, every other service is named instead, so a broken app image
# cannot stop the rest from starting.
if ((${#apps[@]} > 0)); then
  "${COMPOSE[@]}" up -d
else
  "${COMPOSE[@]}" up -d --no-deps postgres cms api profile caddy
fi

# Only when the check before pinning found Caddy's Caddyfile stale. A file that
# validates can still fail when Caddy starts (a bind address or a certificate);
# `--wait` cannot see that, since Caddy is "running" between restarts, so the
# public probe below is the check, and its failure message names Caddy.
if $caddy_stale; then
  log "Recreating caddy on the new Caddyfile"
  "${COMPOSE[@]}" up -d --force-recreate --no-deps caddy
fi

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
  if $caddy_stale; then
    echo "Caddy was recreated on a new Caddyfile in this run (docker logs $PROJECT-caddy-1). $CADDY_REVERT" >&2
  fi
  exit 1
fi

deployed=$(docker inspect --format '{{.Config.Image}}' "$PROJECT-profile-1")
log "Deployed $deployed"
[[ $deployed == *":$PROFILE_TAG" ]] || {
  echo "Running image is $deployed, expected tag $PROFILE_TAG" >&2
  exit 1
}

# After every check, so it only ever names images that passed. Written to a
# temporary name and renamed, so a crash mid-write cannot leave half a file.
# App images this run left alone were not checked, so the ones that last passed stay.
if ((${#apps[@]} > 0)); then
  cp "$IMAGES_FILE" "$LAST_GOOD_FILE.tmp"
else
  {
    grep -vE '^(ADMISSION|ADMIN)_IMAGE=' "$IMAGES_FILE"
    grep -E '^(ADMISSION|ADMIN)_IMAGE=' "$LAST_GOOD_FILE" 2> /dev/null || true
  } > "$LAST_GOOD_FILE.tmp"
fi
mv "$LAST_GOOD_FILE.tmp" "$LAST_GOOD_FILE"
log "Recorded $LAST_GOOD_FILE"

# The release is live, so a history that cannot be written only warns.
# Only when it changed, so redeploys do not push older releases out.
[[ -f $HISTORY_FILE && $(tail -n 1 "$HISTORY_FILE") == "$RELEASE" ]] || {
  { [[ ! -f $HISTORY_FILE ]] || tail -n 50 "$HISTORY_FILE"; } > "$HISTORY_FILE.tmp" \
    && echo "$RELEASE" >> "$HISTORY_FILE.tmp" \
    && mv -f "$HISTORY_FILE.tmp" "$HISTORY_FILE"
} || echo "Could not record this release in $HISTORY_FILE." >&2
