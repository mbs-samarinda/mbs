#!/usr/bin/env bash
# Starts, checks and stops one isolated MBSS stack for verification:
# a throwaway Postgres container, a Mailpit container that catches every email,
# the API, Strapi, the profile site, the parent app and the committee app, each on
# its own port and fed only the environment written here. The apps' own .env
# files fill in anything not set, so every key they read is set explicitly.
#
#   stack.sh up            start a new run, print its id when ready
#   stack.sh doctor [run]  read-only: is this run worth driving?
#   stack.sh admin  [run]  create a Strapi admin and print its login
#   stack.sh env    [run]  print the run's URLs and paths as shell assignments
#   stack.sh api-off [run] stop only the API (to see pages with it unreachable)
#   stack.sh api-on  [run] start the API again and wait for /health
#   stack.sh mail-off [run] stop Mailpit (to see the outbox retry)
#   stack.sh mail-on  [run] start Mailpit again, empty, on the same ports
#   stack.sh bucket-off [run] stop MinIO (to see an upload fail)
#   stack.sh bucket-on  [run] start MinIO again, empty, on the same port
#   stack.sh sim [run] -- <args>  run pnpm ppdb-sim with the run's API config
#   stack.sh down   [run]  stop what this run started, keep the evidence
#
# [run] defaults to the newest run under $MBS_VERIFY_ROOT that is still up.
set -euo pipefail

# Physical path: it is compared with /proc/<pid>/cwd, which never holds symlinks.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)
ROOT=${MBS_VERIFY_ROOT:-/tmp/mbs-verify}
PG_PORT=${PG_PORT:-55432}
API_PORT=${API_PORT:-3101}
CMS_PORT=${CMS_PORT:-1437}
PROFILE_PORT=${PROFILE_PORT:-3102}
# 5173 is the dev port, unlike the others: the profile's "Mulai Pendaftaran" link
# is fixed to it on localhost. 5174 goes with it.
ADMISSION_PORT=${ADMISSION_PORT:-5173}
ADMIN_PORT=${ADMIN_PORT:-5174}
MAIL_SMTP_PORT=${MAIL_SMTP_PORT:-51125}
MAIL_WEB_PORT=${MAIL_WEB_PORT:-58125}
MINIO_PORT=${MINIO_PORT:-59000}
MAILPIT_IMAGE=axllent/mailpit:v1.34.0
MINIO_IMAGE=minio/minio:RELEASE.2025-09-07T16-13-09Z
MINIO_BUCKET=mbss-ppdb
MINIO_USER=mbs_verify
MINIO_PASSWORD=mbs_verify_secret
CMS_DB_PASSWORD=mbs_cms_verify
CORE_DB_PASSWORD=mbs_verify

die() { echo "stack: $*" >&2; exit 1; }
log() { echo "stack: $*" >&2; }

resolve_run() {
  local run=${1:-}
  if [[ -z $run ]]; then
    # Newest run that is still up and was started from this checkout. $ROOT is
    # shared by every checkout on the machine, so without the checkout match a
    # bare `down` stops another agent's stack. A stopped run keeps its folder
    # but not its state.
    for d in $(ls -1t "$ROOT" 2>/dev/null); do
      grep -qxF "RUN_REPO=$(printf %q "$REPO")" "$ROOT/$d/state.env" 2>/dev/null && { run=$d; break; }
    done
    if [[ -z $run ]]; then
      # Runs started before RUN_REPO existed match no checkout; name them, so
      # one this checkout started is not left running unseen.
      local unowned
      unowned=$(grep -L '^RUN_REPO=' "$ROOT"/*/state.env 2>/dev/null | xargs -r -n1 dirname | xargs -r -n1 basename | tr '\n' ' ')
      die "no running stack from $REPO under $ROOT; pass its run id${unowned:+ (runs with no checkout recorded: $unowned)}"
    fi
  fi
  [[ -f $ROOT/$run/state.env ]] || die "no state for run $run under $ROOT"
  echo "$run"
}

port_busy() { ss -Htln "sport = :$1" | grep -q .; }

# PIDs whose working directory is $1 and whose command line matches $2.
# Used to refuse a second next/strapi in the same app folder: they share
# .next/dev (which holds a lockfile), .strapi, dist and public/uploads.
procs_in() {
  local dir=$1 pattern=$2 pid
  for pid in $(pgrep -f "$pattern" || true); do
    if [[ $(readlink "/proc/$pid/cwd" 2>/dev/null) == "$dir" ]]; then echo "$pid"; fi
  done
}

# Waits until "$@" succeeds, up to $1 seconds. Logs which check timed out.
wait_for() {
  local secs=$1 what=$2; shift 2
  local start=$SECONDS
  until "$@" >/dev/null 2>&1; do
    ((SECONDS - start < secs)) || { log "timed out after ${secs}s waiting for $what"; return 1; }
    sleep 2
  done
  log "$what ready after $((SECONDS - start))s"
}

# Starts a command in its own process group, appending to $LOGS/<name>.log,
# and records the group id so `down` kills exactly that group.
start_group() {
  local name=$1 dir=$2; shift 2
  # Job control is off in a script, so the subshell is no group leader and
  # setsid makes it one in place: $! is then the new group's id.
  (cd "$dir" && exec setsid env "$@" >>"$LOGS/$name.log" 2>&1 < /dev/null) &
  echo "$!" >"$SCRATCH/$name.pgid"
}

# Stops one recorded group: TERM, up to 10 s to exit, then KILL.
stop_group() {
  local name=$1 pgid
  pgid=$(cat "$SCRATCH/$name.pgid" 2>/dev/null) || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || return 0
  for _ in $(seq 20); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pgid" 2>/dev/null || true
  log "stopped $name (process group $pgid)"
}

# The environment each app gets, as arrays for `env`. Built after the run's
# secrets are known, so call build_envs before using them.
build_envs() {
  API_ENV=(DATABASE_URL="postgres://mbs:$CORE_DB_PASSWORD@127.0.0.1:$PG_PORT/mbs_core"
    NODE_ENV=development LOG_LEVEL=info PORT="$API_PORT"
    BETTER_AUTH_SECRET="$AUTH_SECRET"
    GOOGLE_CLIENT_ID=verify-placeholder GOOGLE_CLIENT_SECRET=verify-placeholder
    FAMILY_APP_URL="http://localhost:$ADMISSION_PORT" ADMIN_APP_URL="http://localhost:$ADMIN_PORT"
    S3_ENDPOINT="http://127.0.0.1:$MINIO_PORT" S3_BUCKET="$MINIO_BUCKET"
    S3_ACCESS_KEY="$MINIO_USER" S3_SECRET_KEY="$MINIO_PASSWORD" S3_REGION=us-east-1
    SMTP_URL="smtp://127.0.0.1:$MAIL_SMTP_PORT" MAIL_FROM="PPDB MBSS <ppdb@mbss.test>"
    NOTIFICATION_WORKER=on BOOTSTRAP_ADMIN_EMAIL=)
  CMS_ENV=(HOST=127.0.0.1 PORT="$CMS_PORT" PUBLIC_URL="http://localhost:$CMS_PORT"
    NODE_ENV=development DATABASE_CLIENT=postgres DATABASE_HOST=127.0.0.1
    DATABASE_PORT="$PG_PORT" DATABASE_NAME=mbs_cms DATABASE_USERNAME=mbs_cms
    DATABASE_PASSWORD="$CMS_DB_PASSWORD" DATABASE_SSL=false
    PROFILE_REVALIDATE_URL="http://localhost:$PROFILE_PORT/api/revalidate"
    PROFILE_APEX=localhost REVALIDATE_SECRET="$REVALIDATE_SECRET" CMS_READ_TOKEN="${CMS_READ_TOKEN:-}"
    PREVIEW_SECRET="${PREVIEW_SECRET:-}" PROFILE_DEV_PORT="$PROFILE_PORT"
    AWS_BUCKET= APP_KEYS="$APP_KEYS" API_TOKEN_SALT="$CMS_SALT" ADMIN_JWT_SECRET="$CMS_SALT"
    TRANSFER_TOKEN_SALT="$CMS_SALT" JWT_SECRET="$CMS_SALT" ENCRYPTION_KEY="$CMS_SALT"
    BOOT_LOCK_TIMEOUT=30s)
  PROFILE_ENV=(PROFILE_APEX=localhost CMS_URL="http://localhost:$CMS_PORT"
    API_BASE_URL="http://localhost:$API_PORT" REVALIDATE_SECRET="$REVALIDATE_SECRET" CMS_READ_TOKEN="${CMS_READ_TOKEN:-}"
    PREVIEW_SECRET="${PREVIEW_SECRET:-}" CMS_HOST="localhost:$CMS_PORT"
    PROFILE_CACHE_DIR="$SCRATCH/profile-cache" MEDIA_BASE_URL=)
  VITE_ENV=(API_ORIGIN="http://127.0.0.1:$API_PORT")
}

load_run() {
  RUN=$(resolve_run "${1:-}")
  # shellcheck disable=SC1090
  source "$ROOT/$RUN/state.env"
  build_envs
}

# --- checks shared by up and doctor -----------------------------------------

pg_ready() {
  # Over TCP on purpose: during init scripts Postgres listens on the socket only,
  # so pg_isready can pass before mbs_cms exists.
  [[ "$(docker exec -e PGPASSWORD="$CMS_DB_PASSWORD" "$CONTAINER" \
    psql -h 127.0.0.1 -U mbs_cms -d mbs_cms -tAc 'select 1' 2>/dev/null)" == 1 ]]
}
# Bodies are read whole before matching: `curl | grep -q` fails under pipefail,
# because grep stops reading at the first match and curl dies on the closed pipe.
api_ready() { [[ $(curl -fsS "http://127.0.0.1:$API_PORT/health") == *'"ok"'* ]]; }
# 200 with all four seeded Site rows proves the seed and the read token ran.
cms_ready() {
  curl -fsS -H "authorization: Bearer ${CMS_READ_TOKEN:-}" "http://127.0.0.1:$CMS_PORT/api/site-list" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).data.length===4?0:1))'
}
mail_ready() { curl -fsS -o /dev/null "http://127.0.0.1:$MAIL_WEB_PORT/readyz"; }
minio_ready() { curl -fsS -o /dev/null "http://127.0.0.1:$MINIO_PORT/minio/health/live"; }
# The bucket answers a signed-out list with 403, not a connection error.
minio_bucket_ready() {
  [[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MINIO_PORT/$MINIO_BUCKET/") == 403 ]]
}
start_minio() {
  # The browser PUTs straight to the bucket from the parent app's origin, so
  # the bucket allows it here exactly as Biznet must in production.
  docker run --rm -d --name "$MINIO_CONTAINER" \
    -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASSWORD" \
    -e MINIO_API_CORS_ALLOW_ORIGIN="http://localhost:$ADMISSION_PORT,http://localhost:$ADMIN_PORT" \
    -p "127.0.0.1:$MINIO_PORT:9000" "$MINIO_IMAGE" server /data >/dev/null
  wait_for 60 minio minio_ready || die "minio not ready; see docker logs $MINIO_CONTAINER"
  docker exec "$MINIO_CONTAINER" mc alias set local http://127.0.0.1:9000 "$MINIO_USER" "$MINIO_PASSWORD" >/dev/null
  docker exec "$MINIO_CONTAINER" mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null
  wait_for 30 "minio bucket $MINIO_BUCKET" minio_bucket_ready || die "bucket $MINIO_BUCKET missing"
}
start_mail() {
  docker run --rm -d --name "$MAIL_CONTAINER" \
    -p "127.0.0.1:$MAIL_SMTP_PORT:1025" -p "127.0.0.1:$MAIL_WEB_PORT:8025" "$MAILPIT_IMAGE" >/dev/null
  wait_for 30 mailpit mail_ready || die "mailpit not ready; see docker logs $MAIL_CONTAINER"
}
profile_ready() {
  [[ $(curl -fsS --max-time 120 -H "Host: smp.localhost:$PROFILE_PORT" \
    "http://127.0.0.1:$PROFILE_PORT/") == *"SMP Islam Terpadu Madina"* ]]
}

# The session call goes through Vite's proxy to the API, which answers 404 for a
# host it does not know. So a 200 also proves the app's own host reached it.
app_ready() {
  [[ $(curl -fsS "http://localhost:$1/") == *'id="root"'* ]] \
    && curl -fsS -o /dev/null "http://localhost:$1/api/auth/get-session"
}

# --- commands ----------------------------------------------------------------

cmd_up() {
  command -v docker >/dev/null || die "docker is not installed"
  for p in "$PG_PORT" "$API_PORT" "$CMS_PORT" "$PROFILE_PORT" "$ADMISSION_PORT" "$ADMIN_PORT" "$MAIL_SMTP_PORT" "$MAIL_WEB_PORT" "$MINIO_PORT"; do
    port_busy "$p" && die "port $p is already in use; set PG_PORT/API_PORT/CMS_PORT/PROFILE_PORT/ADMISSION_PORT/ADMIN_PORT/MAIL_SMTP_PORT/MAIL_WEB_PORT/MINIO_PORT or stop the other stack"
  done
  local held
  held=$(procs_in "$REPO/apps/profile" "next" ; procs_in "$REPO/apps/cms" "strapi")
  [[ -z $held ]] && held=$(pgrep -f "$REPO/apps/(profile|cms)/node_modules" || true)
  [[ -z $held ]] || die "a next or strapi process already runs in this checkout (pids: $(echo $held)); stop it or use another worktree"

  RUN=$(date +%Y%m%d-%H%M%S)-$$
  local dir=$ROOT/$RUN
  SCRATCH=$dir/scratch LOGS=$dir/evidence/logs
  mkdir -p "$SCRATCH/profile-cache" "$LOGS"
  CONTAINER=mbs-verify-pg-$RUN
  MAIL_CONTAINER=mbs-verify-mail-$RUN
  MINIO_CONTAINER=mbs-verify-minio-$RUN
  AUTH_SECRET=$(openssl rand -hex 32)
  REVALIDATE_SECRET=$(openssl rand -hex 24)
  CMS_READ_TOKEN=$(openssl rand -hex 32)
  PREVIEW_SECRET=$(openssl rand -hex 32)
  APP_KEYS=$(openssl rand -hex 16),$(openssl rand -hex 16)
  CMS_SALT=$(openssl rand -hex 16)
  git -C "$REPO" status --porcelain >"$SCRATCH/git-status.before"

  cat >"$dir/state.env" <<EOF
RUN=$RUN
SCRATCH=$SCRATCH
EVIDENCE=$dir/evidence
LOGS=$LOGS
CONTAINER=$CONTAINER
MAIL_CONTAINER=$MAIL_CONTAINER
MINIO_CONTAINER=$MINIO_CONTAINER
MINIO_PORT=$MINIO_PORT
MINIO_BUCKET=$MINIO_BUCKET
MINIO_USER=$MINIO_USER
MINIO_PASSWORD=$MINIO_PASSWORD
MAIL_SMTP_PORT=$MAIL_SMTP_PORT
MAIL_WEB_PORT=$MAIL_WEB_PORT
PG_PORT=$PG_PORT
API_PORT=$API_PORT
CMS_PORT=$CMS_PORT
PROFILE_PORT=$PROFILE_PORT
ADMISSION_PORT=$ADMISSION_PORT
ADMIN_PORT=$ADMIN_PORT
AUTH_SECRET=$AUTH_SECRET
REVALIDATE_SECRET=$REVALIDATE_SECRET
CMS_READ_TOKEN=$CMS_READ_TOKEN
PREVIEW_SECRET=$PREVIEW_SECRET
APP_KEYS=$APP_KEYS
CMS_SALT=$CMS_SALT
GIT_REV=$(git -C "$REPO" rev-parse --short HEAD)
RUN_REPO=$(printf %q "$REPO")
EOF
  build_envs
  # From here on, any way `up` ends before ready (die, a failed command under
  # set -e, Ctrl-C, a timeout's SIGTERM) tears down what it started. Logs stay.
  UP_RUN=1
  trap 'if [[ -n ${UP_RUN:-} ]]; then UP_RUN=; cmd_down "$RUN" || true; fi' EXIT
  trap 'exit 130' INT TERM
  log "run $RUN, state in $dir"

  docker run --rm -d --name "$CONTAINER" \
    -e POSTGRES_USER=mbs -e POSTGRES_PASSWORD="$CORE_DB_PASSWORD" -e POSTGRES_DB=mbs_core \
    -e CMS_DB_PASSWORD="$CMS_DB_PASSWORD" \
    -v "$REPO/infra/postgres/init-cms-db.sh:/docker-entrypoint-initdb.d/init-cms-db.sh:ro" \
    -p "127.0.0.1:$PG_PORT:5432" postgres:18-alpine >/dev/null
  wait_for 90 postgres pg_ready || die "postgres not ready; see docker logs $CONTAINER"
  start_mail
  start_minio

  (cd "$REPO/packages/db" && env "${API_ENV[@]}" pnpm exec drizzle-kit migrate) >"$LOGS/migrate.log" 2>&1 \
    || die "core migrations failed; see $LOGS/migrate.log"

  start_group api "$REPO/apps/api" "${API_ENV[@]}" node src/server.ts
  start_group cms "$REPO/apps/cms" "${CMS_ENV[@]}" pnpm exec strapi develop
  wait_for 60 api api_ready || die "api not ready; see $LOGS/api.log"
  start_group admission "$REPO/apps/admission" "${VITE_ENV[@]}" pnpm exec vite --port "$ADMISSION_PORT" --strictPort
  start_group admin "$REPO/apps/admin" "${VITE_ENV[@]}" pnpm exec vite --port "$ADMIN_PORT" --strictPort
  wait_for 60 "parent app" app_ready "$ADMISSION_PORT" || die "parent app not ready; see $LOGS/admission.log"
  wait_for 60 "committee app" app_ready "$ADMIN_PORT" || die "committee app not ready; see $LOGS/admin.log"
  # First boot runs every Strapi migration and seed, then builds the admin.
  wait_for 300 cms cms_ready || die "cms not ready; see $LOGS/cms.log"

  # Next 16.4 exits once when it detects an agent, to print an upgrade notice,
  # and lets the same command through if it is retried within five minutes.
  # So a first exit with that notice is retried once; any other exit fails.
  local attempt
  for attempt in 1 2; do
    start_group profile "$REPO/apps/profile" "${PROFILE_ENV[@]}" pnpm exec next dev --port "$PROFILE_PORT"
    profile_up_or_exited() { profile_ready || ! kill -0 -- "-$(cat "$SCRATCH/profile.pgid")"; }
    wait_for 240 "profile (or its exit)" profile_up_or_exited || die "profile not ready; see $LOGS/profile.log"
    profile_ready && break
    grep -q 'stopped to show the upgrade recommendation' "$LOGS/profile.log" && ((attempt == 1)) \
      || die "profile exited; see $LOGS/profile.log"
    cp "$LOGS/profile.log" "$LOGS/profile.upgrade-notice.log"
    log "next stopped for its upgrade notice (kept in profile.upgrade-notice.log); retrying"
  done

  UP_RUN=
  log "ready. drive with: RUN=$RUN"
  log "parent app    http://localhost:$ADMISSION_PORT"
  log "committee app http://localhost:$ADMIN_PORT"
  log "profile       http://localhost:$PROFILE_PORT"
  echo "$RUN"
}

cmd_doctor() {
  load_run "${1:-}"
  local ok=1 name pgid
  check() { if "${@:2}" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; ok=0; fi; }
  echo "run $RUN  commit $GIT_REV (checkout now at $(git -C "$REPO" rev-parse --short HEAD))"
  for name in api cms profile admission admin; do
    # A missing id must FAIL: `kill -0 -- -0` would signal our own group and pass.
    pgid=$(cat "$SCRATCH/$name.pgid" 2>/dev/null || true)
    group_alive() { [[ -n $1 ]] && kill -0 -- "-$1"; }
    check "$name process group ${pgid:-missing} alive" group_alive "$pgid"
  done
  port_owner() {
    local pid
    pid=$(ss -Htlnp "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
    [[ -n $pid && $(ps -o pgid= -p "$pid" | tr -d ' ') == "$(cat "$SCRATCH/$2.pgid")" ]]
  }
  check "port $API_PORT owned by this run's api" port_owner "$API_PORT" api
  check "port $CMS_PORT owned by this run's cms" port_owner "$CMS_PORT" cms
  check "port $PROFILE_PORT owned by this run's profile" port_owner "$PROFILE_PORT" profile
  check "port $ADMISSION_PORT owned by this run's parent app" port_owner "$ADMISSION_PORT" admission
  check "port $ADMIN_PORT owned by this run's committee app" port_owner "$ADMIN_PORT" admin
  check "postgres container $CONTAINER answers" pg_ready
  check "mailpit $MAIL_CONTAINER answers on $MAIL_WEB_PORT" mail_ready
  check "minio $MINIO_CONTAINER answers on $MINIO_PORT" minio_ready
  check "bucket $MINIO_BUCKET exists" minio_bucket_ready
  cms_tables() {
    docker exec -e PGPASSWORD="$CMS_DB_PASSWORD" "$CONTAINER" \
      psql -h 127.0.0.1 -U mbs_cms -d mbs_cms -tAc "select count(*) from sites" | grep -x 4
  }
  check "cms writes to the verify database (4 sites rows)" cms_tables
  check "api /health" api_ready
  check "cms serves 4 published sites" cms_ready
  check "profile serves smp.localhost:$PROFILE_PORT" profile_ready
  check "parent app serves localhost:$ADMISSION_PORT and reaches its API host" app_ready "$ADMISSION_PORT"
  check "committee app serves localhost:$ADMIN_PORT and reaches its API host" app_ready "$ADMIN_PORT"
  ((ok)) || exit 1
}

cmd_admin() {
  load_run "${1:-}"
  local email=verify@mbss.test password=Verify-mbss-1
  (cd "$REPO/apps/cms" && env "${CMS_ENV[@]}" pnpm exec strapi admin:create-user \
    --email "$email" --password "$password" --firstname Verify --lastname Agent) \
    >"$LOGS/admin-create.log" 2>&1 || grep -qi 'already exists' "$LOGS/admin-create.log" \
    || die "admin create failed; see $LOGS/admin-create.log"
  echo "CMS_ADMIN_URL=http://localhost:$CMS_PORT/admin"
  echo "CMS_ADMIN_EMAIL=$email"
  echo "CMS_ADMIN_PASSWORD=$password"
}

cmd_api_off() {
  load_run "${1:-}"
  stop_group api
}

cmd_api_on() {
  load_run "${1:-}"
  kill -0 -- "-$(cat "$SCRATCH/api.pgid")" 2>/dev/null && die "the api is already running"
  start_group api "$REPO/apps/api" "${API_ENV[@]}" node src/server.ts
  wait_for 60 api api_ready || die "api not ready; see $LOGS/api.log"
}

cmd_mail_off() {
  load_run "${1:-}"
  docker stop "$MAIL_CONTAINER" >/dev/null && log "stopped $MAIL_CONTAINER"
}

cmd_mail_on() {
  load_run "${1:-}"
  docker inspect "$MAIL_CONTAINER" >/dev/null 2>&1 && die "mailpit is already running"
  start_mail
}

cmd_bucket_off() {
  load_run "${1:-}"
  docker stop "$MINIO_CONTAINER" >/dev/null && log "stopped $MINIO_CONTAINER"
}

cmd_bucket_on() {
  load_run "${1:-}"
  docker inspect "$MINIO_CONTAINER" >/dev/null 2>&1 && die "minio is already running"
  start_minio
}

cmd_sim() {
  local run=
  [[ ${1:-} != -- ]] && { run=$1; shift; }
  [[ ${1:-} == -- ]] && shift
  load_run "$run"
  (cd "$REPO" && env "${API_ENV[@]}" node apps/api/scripts/ppdb-sim.ts "$@")
}

cmd_env() {
  load_run "${1:-}"
  cat <<EOF
RUN=$RUN
EVIDENCE=$EVIDENCE
CONTAINER=$CONTAINER
API_URL=http://localhost:$API_PORT
CMS_URL=http://localhost:$CMS_PORT
PROFILE_PORT=$PROFILE_PORT
MINIO_URL=http://127.0.0.1:$MINIO_PORT
MINIO_BUCKET=$MINIO_BUCKET
MINIO_USER=$MINIO_USER
MINIO_PASSWORD=$MINIO_PASSWORD
MAIL_URL=http://localhost:$MAIL_WEB_PORT
MAIL_SMTP=smtp://127.0.0.1:$MAIL_SMTP_PORT
ADMISSION_URL=http://localhost:$ADMISSION_PORT
ADMIN_URL=http://localhost:$ADMIN_PORT
FAMILY_HOST=localhost:$ADMISSION_PORT
STAFF_HOST=localhost:$ADMIN_PORT
APEX_URL=http://localhost:$PROFILE_PORT
SMP_URL=http://smp.localhost:$PROFILE_PORT
SMK_URL=http://smk.localhost:$PROFILE_PORT
SMA_URL=http://sma.localhost:$PROFILE_PORT
REVALIDATE_SECRET=$REVALIDATE_SECRET
CMS_READ_TOKEN=${CMS_READ_TOKEN:-}
PREVIEW_SECRET=${PREVIEW_SECRET:-}
EOF
}

cmd_down() {
  load_run "${1:-}"
  local name
  for name in admission admin profile cms api; do stop_group "$name"; done
  docker stop "$CONTAINER" >/dev/null 2>&1 && log "stopped $CONTAINER" || true
  docker stop "${MAIL_CONTAINER:-}" >/dev/null 2>&1 && log "stopped $MAIL_CONTAINER" || true
  docker stop "${MINIO_CONTAINER:-}" >/dev/null 2>&1 && log "stopped $MINIO_CONTAINER" || true

  # A run must not leave tracked files changed. Report it; reverting is the
  # caller's call, since the user may have been editing at the same time.
  git -C "$REPO" status --porcelain >"$EVIDENCE/git-status.after"
  if ! diff -q "$SCRATCH/git-status.before" "$EVIDENCE/git-status.after" >/dev/null; then
    log "WARNING: git status changed during the run:"
    diff "$SCRATCH/git-status.before" "$EVIDENCE/git-status.after" >&2 || true
  fi
  rm -rf "$SCRATCH"
  rm -f "$ROOT/$RUN/state.env"
  log "evidence kept in $EVIDENCE"
}

case ${1:-} in
  up) cmd_up ;;
  doctor) cmd_doctor "${2:-}" ;;
  admin) cmd_admin "${2:-}" ;;
  env) cmd_env "${2:-}" ;;
  api-off) cmd_api_off "${2:-}" ;;
  api-on) cmd_api_on "${2:-}" ;;
  mail-off) cmd_mail_off "${2:-}" ;;
  mail-on) cmd_mail_on "${2:-}" ;;
  bucket-off) cmd_bucket_off "${2:-}" ;;
  bucket-on) cmd_bucket_on "${2:-}" ;;
  sim) shift; cmd_sim "$@" ;;
  down) cmd_down "${2:-}" ;;
  *) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
