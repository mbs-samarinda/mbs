#!/usr/bin/env bash
# Validates a Caddyfile with the Caddy image compose.prod.yml pins, so every
# caller checks with exactly the Caddy that production runs. Called by CI on
# every pull request, by the release before it copies anything to the box, and
# by deploy.sh with the box's real values.
#
#   ./validate-caddyfile.sh <directory holding compose.prod.yml and Caddyfile>
#
# Reads PROFILE_APEX, CMS_HOST and CADDY_EMAIL from the environment.
set -euo pipefail

dir=$(cd "${1:?usage: validate-caddyfile.sh <directory>}" && pwd)

image=$(sed -n 's/^ *image: \(caddy@sha256:[0-9a-f]*\)$/\1/p' "$dir/compose.prod.yml")
if [[ -z $image ]]; then
  echo "No pinned caddy image in $dir/compose.prod.yml" >&2
  exit 2
fi

# An empty value turns a correct Caddyfile into an invalid one, and that error
# would point at the file instead of the environment.
for name in PROFILE_APEX CMS_HOST CADDY_EMAIL; do
  if [[ -z ${!name:-} ]]; then
    echo "$name is not set" >&2
    exit 2
  fi
done

exec docker run --rm --network none -e PROFILE_APEX -e CMS_HOST -e CADDY_EMAIL \
  -v "$dir/Caddyfile:/etc/caddy/Caddyfile:ro" "$image" \
  caddy validate --config /etc/caddy/Caddyfile
