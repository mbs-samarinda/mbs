# The profile site. Build context is the repository root.
#
# Nothing is built here. `pnpm build` runs outside — on your machine locally, on
# the runner in CI — and this copies the result. Building inside Docker would
# have no Turborepo remote-cache token and would rebuild what the cache already
# holds.
#
# Requires `pnpm --filter @mbs/profile build` to have run first.
FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

WORKDIR /app
ENV NODE_ENV=production

# `output: "standalone"` traces exactly what the server requires and writes it
# with the workspace layout preserved, so the entrypoint sits at apps/profile/.
COPY apps/profile/.next/standalone ./

# Standalone deliberately excludes both of these — Next expects a CDN to serve
# them. Nothing here does, so they are copied in. Leaving them out still returns
# 200 on every page: the site simply loses every script chunk and photograph,
# which no smoke check that only reads status codes can see.
COPY apps/profile/.next/static ./apps/profile/.next/static
COPY apps/profile/public ./apps/profile/public

# Two directories the process writes to, both created and chowned here because
# every COPY above lands as root and the process does not run as one.
#
# .next/cache: next/image writes optimized copies of Strapi's photographs here
# on first request.
#
# .cache/content: the `"use cache"` store, which compose mounts a volume over.
# This one has to exist *in the image*, not just at runtime — Docker copies an
# image directory's ownership onto a fresh named volume, and initialises the
# volume as root:root when the mountpoint is absent. A root-owned volume means
# the handler's writes fail on EACCES, `set` swallows it, and nothing is ever
# cached with no error anywhere. Verified both ways with a probe container.
#
# Both failures are invisible to a smoke check that only reads status codes:
# pages still return 200, they are just uncached and missing every photograph.
RUN mkdir -p /app/apps/profile/.next/cache /app/.cache/content \
  && chown -R node:node /app/apps/profile/.next /app/.cache

USER node
EXPOSE 3002
ENV PORT=3002

# 0.0.0.0, not 127.0.0.1. `proxy.ts` rewrites through `NextResponse.rewrite`
# with a URL built from the request Host header; when the bound address does not
# match, Next stops treating the rewrite as its own and tries to proxy to
# itself, which ECONNRESETs into a 500 on every host. This is also what
# `next start` binds by default, which is why it never shows up in dev.
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/profile/server.js"]
