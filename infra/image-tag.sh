#!/usr/bin/env bash
# Prints the image tag for one app: ./image-tag.sh <app> <turbo-task>
#
# This exists as a file rather than inline in the workflow because two jobs need
# the answer — the one that builds and the one that deploys — and they have to
# agree exactly. Two copies of this arithmetic drifting apart would mean the
# deploy pinning a tag nothing ever published, and the failure would be a pull
# error on the box rather than anything visible in CI.
#
# CMS_URL must be set to the same value the build uses: it is in turbo.json's
# build env, so it changes the hash.
set -euo pipefail

readonly app=${1:?usage: image-tag.sh <app> <turbo-task>}
readonly task=${2:?usage: image-tag.sh <app> <turbo-task>}

# --dry=json, not --affected. On a push to main --affected compares main with
# itself and resolves to nothing; the dry run reports the task hash regardless.
#
# Turbo's hash already folds in the whole dependency graph and the task's `env`
# list, which is why it is used instead of path filters: a change in
# packages/ui moves the profile's hash, and a filter on apps/profile would not
# see it.
turbo_hash=$(pnpm exec turbo run "$task" --filter="@mbs/$app" --dry=json \
  | jq -er --arg pkg "@mbs/$app" 'first(.tasks[] | select(.package == $pkg) | .hash)')

# The image holds more than the turbo output.
#
# - Dockerfile: an edit with unchanged application code must still rebuild.
# - .dockerignore: it decides what reaches the image at all, and getting it
#   wrong is how a .env ends up in one.
# - pnpm-lock.yaml: turbo does not fold it in — measured, a dependency bump
#   leaves both @mbs/profile#build and @mbs/api#typecheck on the same hash. The
#   api and cms images run `pnpm install` from it at docker build time, so
#   without it a `pnpm update` for a security patch would match the published
#   tag, skip the build, and leave the old version running.
printf '%s' \
  "$turbo_hash" \
  "$(sha256sum "apps/$app/Dockerfile" | cut -d' ' -f1)" \
  "$(sha256sum .dockerignore | cut -d' ' -f1)" \
  "$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)" \
  | sha256sum | cut -c1-16
