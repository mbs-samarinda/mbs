# The parent app: built files behind a small Caddy. Build context is the repository root.
#
# Nothing is built here, for the reason apps/profile/Dockerfile gives. Requires
# `pnpm --filter @mbs/admission build` to have run first.
#
# The same Caddy, by digest, that infra/compose.prod.yml runs in front, so the
# server already has most of its layers.
FROM caddy@sha256:ad27e531c8b286ff153c0e6e16587a1583e4111bb58c4d83bd73d6d3ef0a0ce1

COPY apps/admission/Caddyfile /etc/caddy/Caddyfile
COPY apps/admission/dist /srv

USER nobody
EXPOSE 8080
