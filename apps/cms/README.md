# @mbs/cms

Strapi 5. Holds the content of the four profile sites: the umbrella and the
three schools. Editors write here and `apps/profile` reads it through the
public REST API.

## Commands

```
pnpm --filter @mbs/cms dev               # admin at http://localhost:1337/admin
pnpm --filter @mbs/cms build
pnpm --filter @mbs/cms typecheck
pnpm --filter @mbs/cms test:integration  # needs Postgres, see below
```

Copy `.env.example` to `.env` first. In production every `DATABASE_*`
variable is required. Locally they fall back to `localhost:5432/strapi`.

The integration suite boots Strapi against a database whose name must end in
`_test` (default `mbs_cms_test` on `localhost:5432`, override with the
`DATABASE_*` variables). It seeds content, so never point it at a database
anybody works in.

## Layout

- `src/index.ts` registers the document middleware and runs bootstrap: seeds
  and backfills, under a Postgres advisory lock.
- `src/owner-scope.ts` is the editor role and the check that keeps an editor
  inside their own schools. `src/public-read.ts` is what the Public role reads.
- `src/backfills.ts` repairs rows that already exist, once per database.
- `src/revalidate.ts` tells the profile app that published content changed.
- `src/seed/` holds what a fresh database starts with.

## Types are generated

`build`, `typecheck` and `test:integration` run `strapi ts:generate-types`
first. Do not drop it. `types/generated/` is gitignored, and it gives
`api::page.page` and the rest their real shapes. Locally the files exist
because `strapi develop` writes them, so code typed against them compiles
locally and fails in CI without that step. It reads schema files only and
never queries the database.

## Changing a schema

Bootstrap only adds content: seeds create rows that are missing, and
`backfillOnce` repairs rows that exist. Renaming a field or changing its type
goes in `database/migrations`. Strapi syncs the schema before bootstrap runs
and drops the old column, so a backfill that copies the old values runs too
late and finds nothing. Migrations run before that sync.

Never change a component field's type in place. Add a new field, backfill it,
then remove the old one.

Permissions are code too. The editor role and the Public role's content
grants are rebuilt from `src/owner-scope.ts` and `src/public-read.ts` on every
boot, so a change made to either in the admin panel is reverted on the next
start.
