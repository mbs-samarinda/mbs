#!/usr/bin/env bash
# Prints the generated half of /opt/mbs/.env, once.
#
#   ./generate-secrets.sh
#   ./generate-secrets.sh >> /opt/mbs/.env     # then remove the blank originals
#
# Every value here must be STABLE FOREVER. Strapi's keys sign admin sessions and
# API tokens, so rotating one logs every editor out and invalidates every token;
# the database passwords are set on the role at first boot and changing them
# without an ALTER ROLE locks the application out of its own data. CI must never
# run this — that is the whole reason it is a script you run by hand rather than
# a step in the deploy.
set -euo pipefail

# Refuses rather than appends a second set, which would leave two values for one
# variable in the file and let the shell pick the last — silently rotating keys
# nobody meant to rotate.
if [[ -f /opt/mbs/.env ]] && grep -qE '^APP_KEYS=.+' /opt/mbs/.env; then
  echo "/opt/mbs/.env already has APP_KEYS set." >&2
  echo "These values must never be regenerated: every admin session and API" >&2
  echo "token is signed with them. Nothing written." >&2
  exit 1
fi

# hex, not base64. The Postgres password is interpolated into a URL in
# compose.prod.yml and compose does no percent-encoding, so a `/`, `+`, `@`, `#`
# or `?` would end the authority component early — the API then either fails its
# z.url() check at boot or dials a host nobody meant. `openssl rand -base64`
# produces exactly those characters, which is why it is not used here.
hex() { openssl rand -hex "$1"; }

# Strapi wants base64 for these, and never puts them in a URL.
b64() { openssl rand -base64 "$1" | tr -d '\n'; }

cat <<VALUES
POSTGRES_PASSWORD=$(hex 32)
CMS_DB_PASSWORD=$(hex 32)
REVALIDATE_SECRET=$(hex 24)
# Four, comma-separated, as config/server.ts reads with env.array.
APP_KEYS=$(b64 16),$(b64 16),$(b64 16),$(b64 16)
API_TOKEN_SALT=$(b64 16)
ADMIN_JWT_SECRET=$(b64 16)
TRANSFER_TOKEN_SALT=$(b64 16)
JWT_SECRET=$(b64 16)
ENCRYPTION_KEY=$(b64 16)
# The API's schema requires at least 32 characters.
BETTER_AUTH_SECRET=$(hex 32)
VALUES
