# MBSS

School profile sites and the admission system for MBSS.

The decisions behind this code — what the system is, why it is shaped this way,
and the rules the code must preserve — live in a separate repository:
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge). Read it
before changing anything here. If the code and those documents disagree, work
out which one is stale and fix that one in the same change.

## Requirements

- Node 24 (see `.nvmrc`)
- pnpm 11
- Docker, for the local PostgreSQL server

## Getting started

```bash
pnpm install
docker compose up -d                    # PostgreSQL, core and CMS databases
cp apps/api/.env.example apps/api/.env  # then fill in DATABASE_URL
DATABASE_URL=postgres://mbs:mbs_local_dev@localhost:5432/mbs_core pnpm db:migrate
pnpm dev                                # every app at once
```

Each app reads the `.env` beside it. Only the API needs one today: copy its
`.env.example` and set `DATABASE_URL`. Every other value there has a working
default.

## What is where

```
apps/
  api                Fastify + oRPC. The only source of truth for admission.
  admission          React + Vite. The parent application.
  admission-admin    React + Vite. The committee application.
  profile            Next.js. One app serving every school subdomain.
  cms                Strapi. Profile content only, with its own database.

packages/
  api-contract       The oRPC contract and its Zod schemas. Browser-safe.
  db                 Drizzle client, schema, and migrations. Used by api only.
  ui                 shadcn/ui components on Base UI, plus the design tokens.
  school-config      The fixed school list and compile-time facts.
  typescript-config  Shared tsconfig bases.
```

Apps may depend on packages. An app never imports another app's source; they
talk over HTTP.

## Ports in development

```
3001  api
3002  profile
5173  admission
5174  admission-admin
1337  cms
```

Both Vite apps proxy `/api` to the API, the same way Caddy does in production,
so neither needs an API URL in its environment.

## Checks

```bash
pnpm format        # rewrite formatting
pnpm lint
pnpm typecheck
pnpm test          # fast tests
pnpm build
pnpm gate          # all of the above, in CI's order
```

Every check is a task in each workspace, so turbo runs them in parallel and
caches the results. `pnpm lint` on an unchanged tree finishes in about a
quarter of a second. To check one workspace, filter it:

```bash
pnpm exec turbo run lint --filter=@mbs/api
```

Tests that need a real database are named `*.integration.test.ts` and run
separately:

```bash
pnpm --filter @mbs/api test:integration
```

## Components

`packages/ui` is the shadcn/ui component library for every front end, built on
Base UI primitives. Add a component from any app and the CLI puts it in the
right place:

```bash
pnpm dlx shadcn@latest add dialog -c apps/admission
```

Base components land in `packages/ui/src/components`; anything specific to one
app stays in that app. Import them by path:

```ts
import { Button } from "@mbs/ui/components/button";
import { cn } from "@mbs/ui/lib/utils";
```

Design tokens and the Tailwind entry point live in
`packages/ui/src/styles/globals.css`. Each app's `src/styles.css` imports it and
nothing else.

Two things to know. `apps/profile` has no `components.json` yet, so the CLI
cannot target it — add one when the profile site needs its first component.
And shadcn's own setup pins TypeScript 6 while this workspace is on 7, so a
generated component may occasionally need a small fix after `shadcn add`.

## Database

`packages/db` owns the core schema. After changing `src/schema.ts`:

```bash
pnpm db:generate   # writes a migration into packages/db/drizzle
pnpm db:migrate    # applies it
```

Strapi owns its own database and its own schema lifecycle. The core migrations
never touch it.
