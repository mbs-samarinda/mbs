#!/usr/bin/env bash
# Runs the production Caddyfile, and each PPDB app's own, in the Caddy image that
# compose.prod.yml pins, and checks what reaches each service. CI runs it on every
# pull request. validate-caddyfile.sh only proves the file parses.
#
#   ./test-caddyfile.sh
#
# PROFILE_APEX=localhost, because Caddy signs certificates for that name itself.
# Each service behind it is a stub that answers with its name and what it was sent.
set -euo pipefail

infra=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
image=$(sed -n 's/^ *image: \(caddy@sha256:[0-9a-f]*\)$/\1/p' "$infra/compose.prod.yml")
run=mbs-caddy-test-$$
scratch=$(mktemp -d)
services=(profile cms api admission admin)

cleanup() {
  docker rm -f "$run-front" "$run-app" "${services[@]/#/$run-}" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

failed=0
check() {
  local name=$1 want=$2 got=$3
  if [[ $got =~ $want ]]; then
    echo "ok    $name"
  else
    printf 'FAIL  %s\n      want %s\n      got  %s\n' "$name" "$want" "$got"
    failed=1
  fi
}
# Answers on stdout, retried until the server listens.
ask() {
  local url=$1
  shift
  curl -sk --max-time 5 --retry 20 --retry-all-errors --retry-delay 1 "$@" "$url" || true
}
published_port() { docker port "$1" "$2/tcp" | head -1 | sed 's/.*://'; }

# Read by a container user that is not this one.
chmod 755 "$scratch"

cat > "$scratch/Stub" <<'STUB'
http://:3002, http://:1337, http://:3001, http://:8080 {
	respond "{$NAME} host={host} path={path} xff={header.X-Forwarded-For}"
}
STUB
docker network create "$run" >/dev/null
for service in "${services[@]}"; do
  docker run -d --rm --name "$run-$service" --network "$run" --network-alias "$service" \
    -e "NAME=$service" -v "$scratch/Stub:/etc/caddy/Caddyfile:ro" "$image" >/dev/null
done
docker run -d --rm --name "$run-front" --network "$run" -p 127.0.0.1::443 \
  -e PROFILE_APEX=localhost -e CMS_HOST=cms.localhost -e CADDY_EMAIL=ci@example.com \
  -v "$infra/Caddyfile:/etc/caddy/Caddyfile:ro" "$image" >/dev/null
port=$(published_port "$run-front" 443)
front() {
  local host=$1 path=$2
  shift 2
  ask "https://$host:$port$path" --resolve "$host:$port:127.0.0.1" "$@"
}

for app in admission admin; do
  host=$app.localhost
  check "$host serves its app" "^$app host=$host path=/masuk " "$(front "$host" /masuk)"
  check "$host sends /api to the API with its own host" "^api host=$host path=/api/auth/ok " "$(front "$host" /api/auth/ok)"
  check "$host sends HSTS" "strict-transport-security: max-age=31536000" "$(front "$host" / -o /dev/null -D - | tr -d '\r')"
  check "$host ignores a made-up client address" 'xff=[0-9.]+$' "$(front "$host" /api/x -H 'X-Forwarded-For: 6.6.6.6')"
  check "$host ignores a made-up list of addresses" 'xff=[0-9.]+$' "$(front "$host" /api/x -H 'X-Forwarded-For: 6.6.6.6, 7.7.7.7')"
  [[ $(front "$host" /api/x -H 'X-Forwarded-For: 6.6.6.6') != *6.6.6.6* ]] || check "$host ignores 6.6.6.6" '^$' "it arrived"
done
check "the profile keeps its own /api" "^profile host=localhost path=/api/draft " "$(front localhost /api/draft)"
check "the CMS is untouched" "^cms host=cms.localhost path=/api/x " "$(front cms.localhost /api/x)"

# Each app's own Caddy, over files shaped like a build.
mkdir -p "$scratch/srv/assets"
echo '<div id="root"></div>' > "$scratch/srv/index.html"
echo 'app' > "$scratch/srv/assets/index-abc.js"
chmod -R a+rX "$scratch/srv"
# The bucket's origin reaches the policy only if the name compose sets and the
# name the Caddyfile reads are the same name. A unit test can see one or the
# other, never both, so the value is put in here under the name compose uses and
# looked for in the header Caddy actually sends.
bucket_env=$(sed -n '/^  admission:/,/^  [a-z]/p' "$infra/compose.prod.yml" \
  | sed -n 's/^ *\([A-Z0-9_]*\): \${S3_ENDPOINT.*/\1/p' | head -1)
[[ -n $bucket_env ]] || { echo "FAIL  compose.prod.yml passes no S3_ENDPOINT to admission"; exit 1; }
readonly BUCKET_PROBE=https://bucket.test

for app in admission admin; do
  docker run -d --rm --name "$run-app" --user nobody -p 127.0.0.1::8080 \
    -e "$bucket_env=$BUCKET_PROBE" \
    -v "$infra/../apps/$app/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$scratch/srv:/srv:ro" "$image" >/dev/null
  port=$(published_port "$run-app" 8080)
  headers() { ask "http://127.0.0.1:$port$1" -o /dev/null -D - | tr -d '\r'; }
  check "$app serves its page for any path" 'id="root"' "$(ask "http://127.0.0.1:$port/masuk/kode")"
  page=$(headers /masuk/kode)
  check "$app asks again for its page" "Cache-Control: no-cache" "$page"
  check "$app refuses to be framed" "frame-ancestors 'none'.*X-Frame-Options: DENY|X-Frame-Options: DENY.*frame-ancestors 'none'" "$(tr '\n' ' ' <<< "$page")"
  check "$app sets a strict CSP" "default-src 'none'; script-src 'self' 'sha256-" "$page"
  # A family uploads a receipt from the parent app; both apps show one back.
  check "$app lets the bucket's images load" "img-src [^;]*$BUCKET_PROBE" "$page"
  if [[ $app == admission ]]; then
    check "$app lets a receipt go to the bucket" "connect-src [^;]*$BUCKET_PROBE" "$page"
    check "$app shows the file just chosen" "img-src [^;]*blob:" "$page"
  else
    check "$app keeps the bucket out of connect-src" "connect-src 'self';" "$page"
  fi
  check "$app keeps hashed files for a year" "immutable" "$(headers /assets/index-abc.js)"
  gone=$(headers /assets/index-old.js)
  check "$app answers 404 for a hashed file that is gone" "^HTTP/1.1 404" "$gone"
  [[ $gone != *immutable* ]] || check "$app never keeps that 404" '^$' "$gone"
  docker rm -f "$run-app" >/dev/null
done

exit "$failed"
