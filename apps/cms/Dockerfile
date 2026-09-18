# Strapi. Build context is the repository root.
#
# Like the other two, nothing is compiled here: `pnpm --filter @mbs/cms build`
# runs outside and this copies `dist/`, which holds both the transpiled project
# and the admin panel bundle. Only dependencies are installed in the image.
#
# Requires `pnpm --filter @mbs/cms build` to have run first.
FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS deps

RUN corepack enable
WORKDIR /app

# Strapi depends on no workspace package, so its manifest is the only one the
# install needs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/cms/package.json ./apps/cms/

RUN pnpm install --prod --frozen-lockfile --filter @mbs/cms...

FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app ./
# tsconfig.json is not read at runtime — nothing compiles here — but Strapi uses
# its presence to decide the project is TypeScript, and only then loads config
# and code from dist/. Without it Strapi looks for a config directory that this
# image does not ship and starts with no database connection at all.
COPY apps/cms/package.json apps/cms/tsconfig.json apps/cms/favicon.png ./apps/cms/
COPY apps/cms/dist ./apps/cms/dist
COPY apps/cms/database ./apps/cms/database
COPY apps/cms/public ./apps/cms/public

# Strapi writes into all three at runtime: uploads until slice 5 moves media to
# S3, and the other two on every boot. They are created and chowned here because
# the process does not run as root and cannot make them itself.
RUN mkdir -p /app/apps/cms/public/uploads /app/apps/cms/.strapi /app/apps/cms/.tmp \
  && chown -R node:node /app/apps/cms

USER node
EXPOSE 1337
ENV HOST=0.0.0.0 PORT=1337

WORKDIR /app/apps/cms
# The shim, run directly. Handing it to `node` fails on its shebang line, since
# pnpm's .bin entries are shell scripts rather than JavaScript.
CMD ["node_modules/.bin/strapi", "start"]
