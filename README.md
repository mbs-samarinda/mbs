# MBSS

School profile sites and the admission system for MBSS.

The decisions behind this code — what the system is, why it is shaped this way,
and the rules the code must preserve — live in a separate repository:
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge). Read it
before changing anything here. If the code and those documents disagree, work
out which one is stale and fix that one in the same change.

Design rules live in its brand guide, `docs/brand/brand-guide.md`. Token values
live in `packages/ui/src/styles/globals.css` and, one block per owner,
`apps/profile/src/app/globals.css`.

## Requirements

- Node 24 (see `.nvmrc`)
- pnpm 12 (see `packageManager` in `package.json`)
- Docker, for the local PostgreSQL server

## Getting started

```bash
pnpm install
docker compose up -d                    # PostgreSQL, core and CMS databases, Mailpit, the bucket
cp apps/api/.env.example apps/api/.env
cp apps/cms/.env.example apps/cms/.env
DATABASE_URL=postgres://mbs:mbs_local_dev@localhost:5432/mbs_core pnpm db:migrate
node apps/api/scripts/ensure-bucket.ts  # makes the bucket and its CORS rule
pnpm dev                                # every app at once
```

Each app reads the `.env` beside it, and each `.env.example` is the list of what
that app needs. The two Vite apps need none. Two want real values before anything
starts:

- **`apps/api`** — `DATABASE_URL`, a `BETTER_AUTH_SECRET` of at least 32
  characters, and a Google OAuth client id and secret. Startup validates all of
  them and fails with the list of what is missing. Set `BOOTSTRAP_ADMIN_EMAIL`
  to your own Google address too: nothing can grant staff access before one
  administrator exists, so nothing can grant staff access without it.
- **`apps/cms`** — Strapi's own secrets, and its own database connection.
  Unset, Strapi quietly falls back to SQLite instead of the `mbs_cms` database
  compose just created.

The rest of each file already holds a working local default.

## What is where

```
apps/
  api                Fastify + oRPC. The only source of truth for admission.
  profile            Next.js. One app serving every school subdomain.
  admission          Vite. The parent app. Calls same-origin /api.
  admin              Vite. The committee app. Calls same-origin /api.
  cms                Strapi. Profile content only, with its own database.

packages/
  api-contract       The oRPC contract and its Zod schemas. Browser-safe.
  api-client         How a browser app calls the API: sign-in requests, the typed
                     oRPC client, and the check on where sign-in may return to.
  db                 Drizzle client, schema, and migrations. Used by api only.
  ui                 shadcn/ui components on Base UI, plus the design tokens.
  school-config      The fixed school list, the shared enum values, and other
                     compile-time facts.
  typescript-config  Shared tsconfig bases.
```

Apps may depend on packages. An app never imports another app's source; they
talk over HTTP.

## Ports in development

```
3001  api
3002  profile
1337  cms
5173  parent app
5174  committee app
8025  Mailpit, the inbox for every email the API sends: http://localhost:8025
9000  the bucket, S3-compatible, where receipts and documents go
```

## Checks

```bash
pnpm format        # rewrite formatting
pnpm lint
pnpm typecheck
pnpm test          # fast tests
pnpm build
pnpm gate          # all of the above, in one run
```

Git hooks run a subset of these automatically. Lefthook installs them from
its own postinstall, which `allowBuilds` in `pnpm-workspace.yaml` permits, so
`pnpm install` is all a fresh clone needs. Committing formats and lints the
staged files and checks the commit message is a Conventional Commit; pushing
runs `format:check`, `lint`, `typecheck` and `test`. `lefthook.yml` holds all three. To skip them once,
`LEFTHOOK=0 git commit ...`.

CI runs the same checks as six independent jobs — format and lint, typecheck,
fast tests, database tests, CMS database tests, build — so they finish in parallel and a slow test
run no longer hides a formatting mistake behind it. On a pull request the jobs
run with `--affected`, checking only the changed packages and what depends on
them; a push to `main` checks everything.

A separate `cms schema` check fails a pull request that removes a Strapi field or
changes its type, because Strapi drops that column, and its content, on the next
boot. A deliberate break gets the `schema-break-ok` label.

Linting is type-aware: `oxlint-tsgolint` gives oxlint the TypeScript types, so
it catches unsafe casts and unhandled promises that a syntax-only linter cannot.
It also builds the module graph, so `import/no-cycle` reports circular imports
across packages.

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
Base UI primitives. Add one with the CLI:

```bash
pnpm dlx shadcn@latest add dialog -c packages/ui
```

They land in `packages/ui/src/components`; anything specific to one app stays in
that app. Import them by path:

```ts
import { Button } from "@mbs/ui/components/button";
```

The shared components join class names with the `cn` package. A new app adds
it (`pnpm add cn --filter <app>`) before the CLI writes its first app-local
component there.

Design tokens and the Tailwind entry point live in
`packages/ui/src/styles/globals.css`. Each app's own stylesheet imports it and
adds only the tokens that app alone uses. Tailwind reads the importing app and
`packages/ui`, never another app.

`packages/ui/src/theme-script.ts` runs inline in every page, and the two Vite
apps' images allow it by hash in their CSP. After editing it, put the new hash in
both `Caddyfile`s; each app's `test/csp.test.ts` prints the expected one.

Two things to know. No app has a `components.json` yet, so the CLI cannot target
one. Add shared components with `-c packages/ui`.
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

History tables (`audit_logs`, `application_events`, `applicant_profile_versions`,
`application_document_requirements`) refuse `UPDATE`, `DELETE` and `TRUNCATE`.
A real correction is done by hand in `psql`, inside a transaction that first
runs `select correct_history('why')`. That call leaves its own audit row.

To fill a local database with applications, run the simulator. It calls the
real domain functions, and the same `--seed` writes nothing the second time:

```bash
pnpm ppdb-sim --count 20 --to ENROLLED --seed demo --timings
pnpm ppdb-sim apply SMP-0001 APPROVE_PAYMENT   # one command on one application
```
