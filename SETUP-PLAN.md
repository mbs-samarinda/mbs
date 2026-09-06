# MBSS monorepo — setup plan

Goal: build the workspace described by the knowledge bank
(`github.com/mbs-samarinda/knowledge`) here in `~/Developer/mbss`, starting from
an empty directory.

Nothing in this plan has been executed. It is for review first.

---

## What is here now

```
.agents/skills/        22 skill directories — the real files
.claude/skills/        22 symlinks pointing into .agents/skills/
skills-lock.json       records where each skill came from
```

Those stay. The plan tracks them in git rather than ignoring them, so the setup
travels with the repo.

The directory is not a git repository yet.

## Decisions already made

**Repository name: `mbs-samarinda/mbs`.** `mbss` was taken by an unrelated
monorepo (453 files, last commit 2026-08-28, different app and package names).
That one is left alone. `mbs` is free.

**The knowledge bank stays a separate repository.** It is not copied in and not
added as a submodule. Clone it beside this one and read the two side by side.
The tradeoff accepted: when a decision changes, the code commit and the docs
commit are two separate commits in two repositories, and keeping them in step is
manual. The knowledge bank's README asks for exactly that — if code and docs
disagree, fix whichever is stale in the same change.

## Prerequisite

Docker is not running (`docker version` returned nothing). Phase 3 needs it for
PostgreSQL. Start OrbStack or Docker Desktop before that phase.

Local toolchain is fine: Node 24.19.0, pnpm 11.20.0.

---

## The shape being built

From `docs/03-monorepo-and-tooling.md`:

```
apps/
  api                Fastify + oRPC — the core admission API
  admission          React + Vite — parents
  admission-admin    React + Vite — committee staff
  profile            Next.js — public school sites
  cms                Strapi — profile content only

packages/
  api-contract       Zod schemas + oRPC contracts, browser-safe
  db                 Drizzle client, schema, migrations
  typescript-config  shared tsconfig bases
  ui                 shared React components
  school-config      stable school keys and compile-time facts
```

The dependency rule from the docs: apps may use packages, apps may never import
another app's source. `db` is used by `api` only.

## Build order and why

Each phase ends with the documented gate passing over code that actually does
something, not over empty stubs:

```
oxfmt --check .  →  oxlint  →  turbo typecheck  →  turbo test  →  turbo build
```

**Phase 1 — Repository skeleton**

`git init`, then a `.gitignore` that keeps `.agents/`, `.claude/skills/`,
`.claude/settings.json` and `skills-lock.json` tracked, and ignores
`.claude/settings.local.json` (machine-specific permissions), `node_modules`,
build output, and `.env*` except `.env.example`.

Root `package.json` (pinning Node 24 and pnpm 11), `pnpm-workspace.yaml`,
`turbo.json`, and a single root oxlint + oxfmt config. The docs say to create
config packages only if root config cannot do the job — so no
`packages/oxlint-config` unless a real need shows up.

Then `packages/typescript-config`: one file, five eventual consumers, named in
the docs.

Gate must pass on the empty workspace.

**Phase 2 — The vertical slice that proves the toolchain**

The smallest thing that exercises every risky choice at once:

- `packages/api-contract` — one real oRPC procedure contract with Zod schemas
- `packages/db` — one real Drizzle table plus its migration
- `apps/api` — Fastify with the plugin layout from the docs (`plugins/`,
  `modules/`, `routes/`, `config/`), serving that one procedure against that one
  table
- one Vitest unit test and one `Fastify.inject()` boundary test

This is where TypeScript 7 meets oxlint 1.81, Drizzle 0.45, oRPC 1.15 and
Fastify 5.12. If any of those disagree, it surfaces now instead of after ten
packages exist. Versions get pinned exactly, per the docs' instruction to pin
oRPC and prefer stable.

`apps/api/src/config/env.ts` validates environment variables once at startup,
with a no-values `.env.example` next to it. The docs explicitly forbid one
monorepo-wide env package.

**Phase 3 — Local database**

`docker-compose.yml` with one PostgreSQL server holding two logically separate
databases — core and CMS — with separate credentials, because `docs/11` gives
them separate migration owners. Migrations run as an explicit command, never
automatically on API boot.

At this point the Phase 2 integration test runs against real PostgreSQL, which is
what the testing doc asks for.

**Phase 4 — First frontend**

`apps/admission` (React + Vite, TanStack Router/Query/Form, Tailwind,
shadcn/ui on Base UI, React Compiler) consuming the typed oRPC client from
`api-contract`. The dev proxy sends `/api` to Fastify so the app never needs an
API base URL, matching production.

One real screen end to end, not a placeholder.

**Phase 5 — Second frontend and the shared UI package**

`apps/admission-admin`, same stack, plus TanStack Table for committee lists.
`packages/ui` gets created _here_ — when two apps genuinely want the same
component — rather than up front with nothing in it.

**Phase 6 — Public site and CMS**

`apps/profile` (Next.js, one app serving all school subdomains via hostname →
school key) and `apps/cms` (Strapi).

Strapi needs its own handling: own build, own CLI, own database, own schema
lifecycle. It participates in turbo through its own scripts and stays out of the
shared `typecheck`/`lint` tasks, or its generated types will fight the gate.

`packages/school-config` gets created here, when `profile` and `api` both need
the school keys — its second consumer.

**Phase 7 — CI**

A GitHub Actions workflow running the gate in order, then building container
images tagged by commit SHA. Per `docs/11`, applications are never built on the
VPS, and deployments pin immutable tags rather than `latest`.

Deployment itself (Caddy, VPS, backups) is a separate piece of work, not part of
setting the repository up.

---

## Deliberately not in this plan

- `packages/ui`, `packages/school-config`, `apps/profile`,
  `apps/admission-admin` on day one. They arrive in the phase that gives them a
  second consumer or a real screen. Creating them empty makes the gate pass while
  proving nothing.
- Any `utils` / `common` / `shared` package — the docs forbid them by name.
- A feature-flag framework, Redis, a workflow engine, or multi-tenant machinery —
  all listed as rejected decisions in the knowledge bank.
- Deployment to the VPS.

## Open questions

None blocking. The remote can be created at any point — phases 1–6 do not need
it.
