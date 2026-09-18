# The core API. Build context is the repository root.
#
# There is no build step: Node 24 strips types and runs the .ts sources
# directly, so the image ships TypeScript, and `packages/db` as source rather
# than a dist/.
#
# That is why this installs with `pnpm install` and not `pnpm deploy`. Deploy
# copies workspace packages bodily into node_modules, and Node refuses to strip
# types under node_modules — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on
# the first `@mbs/db` import. A workspace install links them instead, and the
# link resolves to packages/db outside node_modules, which is exactly why this
# works when you run it from a clone.
FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS deps

RUN corepack enable
WORKDIR /app

# Manifests first, so a source-only change reuses the install layer. Only the
# API's own workspace subtree is copied; `--frozen-lockfile` is happy with the
# other members absent, and a member this app does not use has no business
# invalidating its install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY packages/db/package.json ./packages/db/
COPY packages/school-config/package.json ./packages/school-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# This layer is ~500 MB, most of it Next.js and its swc binary, which pnpm
# installs because `better-auth` declares Next an optional peer. Nothing here
# imports it. Excluding it means changing peer resolution for the whole
# workspace, which is a dependency change and not this slice; the cost is a
# one-time pull, since the layer only moves when the lockfile does.
RUN pnpm install --prod --frozen-lockfile --filter @mbs/api...

FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/api-contract ./packages/api-contract
COPY packages/school-config ./packages/school-config

USER node
EXPOSE 3001
ENV PORT=3001

WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
