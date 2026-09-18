#!/usr/bin/env bash
# Prints the generated half of /opt/mbs/.env, once.
#
#   ./generate-secrets.sh
#   ./generate-secrets.sh >> /opt/mbs/.env     # then remove the blank originals
#
# Run it as the deploy user that owns /opt/mbs, not under sudo: the shell opens
# a `>>` target before sudo runs, so `sudo ... >> /opt/mbs/.env` is the
# unprivileged user writing a root-owned file, and fails.
#
# Every value here must be STABLE FOREVER. Strapi's keys sign admin sessions and
# API tokens, so rotating one logs every editor out and invalidates every token;
# the database passwords are set on the role at first boot and changing them
# without an ALTER ROLE locks the application out of its own data. CI must never
# run this — that is the whole reason it is a script you run by hand rather than
# a step in the deploy.
set -euo pipefail

readonly ROOT=/opt/mbs
readonly ENV_FILE=$ROOT/.env

refuse() {
  echo "$1" >&2
  echo "These values must never be regenerated: every admin session and API" >&2
  echo "token is signed with them. Nothing written." >&2
  exit 1
}

# This guard must never fail open, and the obvious version does. It was
# `[[ -f $ENV_FILE ]] && grep -q ...`, which is false whenever this user cannot
# traverse $ROOT — so running it unprivileged against a root-owned tree printed
# a second full set of keys quite happily. Append those and the file holds two
# values for one variable, the shell takes the last, and every editor is logged
# out. So anything short of proof that no keys exist yet is a refusal.
if [[ -d $ROOT ]] && { [[ ! -r $ROOT ]] || [[ ! -x $ROOT ]]; }; then
  refuse "Cannot read $ROOT, so cannot tell whether keys already exist."
fi

if [[ -e $ENV_FILE ]]; then
  [[ -r $ENV_FILE ]] || refuse "$ENV_FILE exists but this user cannot read it."
  grep -qE '^APP_KEYS=.+' "$ENV_FILE" && refuse "$ENV_FILE already has APP_KEYS set."
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
