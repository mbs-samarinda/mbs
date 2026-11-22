---
name: verify-mbss
description: Launch an isolated MBSS stack (throwaway Postgres, Mailpit, API, Strapi CMS, Next.js profile site) and drive it in headless Chromium to prove a change works the way a visitor or editor sees it. Use after changing the profile site, the CMS, the API (sign-in, admission, email), or the public admission endpoint, or whenever asked to verify, screenshot, or demo MBSS behavior.
---

# Verify MBSS

MBSS has one main thing a user touches: the **profile site** (`apps/profile`). It is a single Next.js app that serves four sites by hostname: the umbrella at the apex and the SMP, SMK and SMA schools on subdomains. Its content comes from **Strapi** (`apps/cms`), where editors write and publish. Admission dates come from the **API** (`apps/api`). The parent and committee admission apps are not built yet, so there is nothing of theirs to verify.

Two helpers live next to this file. Run both from the repo root:

- `stack.sh` starts, checks and stops the stack.
- `drive.mjs` clicks through pages in a headless browser and saves what it sees.

The feature map in [`features/`](features/README.md) says how to drive each user-facing feature. Read the index first, then the feature's own file.

## Launch

```bash
S=.claude/skills/verify-mbss
$S/stack.sh up          # prints the run id on its last line once everything is ready
eval "$($S/stack.sh env)"  # sets RUN, EVIDENCE, SMP_URL, CMS_URL, ... in this shell
```

`up` builds everything from empty. It starts Postgres 18 in a `--rm` container named `mbs-verify-pg-<run>`, starts Mailpit (`axllent/mailpit`, also `--rm`, named `mbs-verify-mail-<run>`) to catch every email, runs the core migrations, and starts the API with its notification worker on and pointed at that Mailpit. Strapi then boots against its own `mbs_cms` database, runs its migrations and seeds all four sites, and sets up the profile's read token. Send it on REST reads, as the profile does: `-H "authorization: Bearer $CMS_READ_TOKEN"` (`stack.sh env` sets it). Without it the CMS answers 403, even for published rows. Last comes `next dev` for the profile. It only prints the run id after each layer passes a real check: the API's `/health` says ok, the CMS serves 4 published sites, and `smp.localhost` renders "SMP Islam Terpadu Madina". A fresh run takes about 1–2 minutes. If `up` fails, it tears down what it started and names the log to read.

Ports: Postgres `55432`, API `3101`, CMS `1437`, profile `3102`, Mailpit SMTP `51125` and web `58125`. These are deliberately not the dev ports (5432, 3001, 1337, 3002, 1025, 8025), so a running `pnpm dev` is left alone. Override them with `PG_PORT`, `API_PORT`, `CMS_PORT`, `PROFILE_PORT`, `MAIL_SMTP_PORT` and `MAIL_WEB_PORT`.

The API picks its auth instance from the `Host` header. Send `Host: $FAMILY_HOST` for the parent app's routes and email codes, and `Host: $STAFF_HOST` for the committee app's. Any other host, `localhost:3101` included, gets no `/api/auth/*` routes and no session. Run the simulator through the stack, `stack.sh sim -- <args>`, so it uses the run's database and auth key. `stack.sh sim -- --staff-session <email>` prints a staff `host:` and `cookie:` pair for `curl` or a browser. Read sent email from Mailpit's API at `$MAIL_URL/api/v1/messages`, or open `$MAIL_URL` in Chromium. `stack.sh` sets every key the apps need, with fresh secrets for each run, so the user's values never decide where a run points. The apps still load their own `apps/*/.env` files, which fill in any key `stack.sh` leaves unset, such as `DATABASE_SCHEMA` or `AWS_ENDPOINT`. If a run behaves differently from a fresh clone, check those files first.

Site URLs (`*.localhost` resolves to 127.0.0.1 in Chromium):

| Site | URL |
| --- | --- |
| Umbrella (apex) | `http://localhost:3102` |
| SMP / SMK / SMA | `http://smp.localhost:3102`, `smk.`, `sma.` |
| Strapi admin | `http://localhost:1437/admin` |
| API | `http://localhost:3101` |

With curl, send the host header instead: `curl -H "Host: smp.localhost:3102" http://127.0.0.1:3102/`.

To log in to Strapi, run `$S/stack.sh admin` once per run. It creates `verify@mbss.test` with the password `Verify-mbss-1` and prints both.

**One stack per checkout.** `next dev` holds a lock in `apps/profile/.next/dev`, and Strapi writes into `apps/cms/.strapi`, `dist` and `public/uploads`. So `up` refuses to start if any `next` or `strapi` process already runs in this checkout, including the user's own `pnpm dev`. Do not stop the user's process to get around this. Ask them, or run the skill from a separate git worktree that has had its own `pnpm install`.

## Doctor

```bash
$S/stack.sh doctor      # read-only; exits 1 if any line says FAIL
```

It checks that each process group is alive, and that each port is owned by this run's process, not someone else's. It checks that the Postgres container and Mailpit answer and that Strapi wrote its 4 `sites` rows into the verify database, not into a dev database. It also checks the API, the CMS and the profile from outside. Its first line shows the commit the run started from next to the current one. If they differ, the stack is running old code for anything that does not hot-reload. Run doctor before driving, and again whenever something looks off.

## Drive

```bash
node $S/drive.mjs --out "$EVIDENCE/<feature-id>" [--state <file>] [--mobile] <step>...
```

| Step | Does |
| --- | --- |
| `goto:<url>` | open a page, log the HTTP status; a 5xx fails the step |
| `click:<role>:<name>` | click the first element with that ARIA role and exact accessible name |
| `tryclick:<role>:<name>` | the same, but skip it if it does not show within 5 s (popups that come only sometimes) |
| `fill:<role>:<name>=<value>` | type into a textbox or searchbox |
| `press:<key>` | press a key |
| `see:<role>:<name>` | wait up to 30 s for that element |
| `text:<text>` | wait up to 30 s for that text anywhere |
| `shot:<label>` | save `<label>.png` (full page), `<label>.aria.txt` (accessibility tree) and `<label>.url` |
| `errors` | ask `next dev` for the open page's errors through its MCP endpoint (`/_next/mcp`, tool `get_errors`); log each with its source file and line, and fail if there are any |

Steps run in order. On the first failure it saves `fail-<n>.png` and exits 1. Everything goes into `<out>/drive.log`, including every `console.error`, page error, HTTP 4xx/5xx and request that got no answer at all (`failed net::...`). `--state` keeps cookies and local storage between calls, which a Strapi login needs. `--mobile` uses a Pixel 7 viewport.

Example: does the SMP home page render, and does its Profil link work?

```bash
node $S/drive.mjs --out "$EVIDENCE/school-pages" \
  goto:$SMP_URL/ shot:home click:link:Profil "see:heading:Profil SMP Islam Terpadu Madina" shot:profil
```

Find handles in a `shot`'s `.aria.txt` instead of guessing. Use roles and names, never CSS classes or coordinates. Playwright is the global install, found through the `playwright` command on `PATH`, with the newest Chromium from `~/.cache/ms-playwright`. Set `PLAYWRIGHT_MODULE` to point the helper somewhere else.

## Evidence

Evidence goes to `/tmp/mbs-verify/<run>/evidence/`. Set `MBS_VERIFY_ROOT` to use a different parent folder; `/tmp` is cleared on reboot. It holds:

- `logs/` holds each app's full log, the migration log and `admin-create.log`. If Next stopped once for its upgrade notice, that log is kept as `profile.upgrade-notice.log`.
- `<feature-id>/` holds the `drive.mjs` output for each journey.
- `git-status.after` records the tree as `down` left it.

Proof standards:

- Drive the real user path: links and buttons on the page, and the Strapi admin for content changes. Never use Strapi's REST API to make a change you are proving. Read-only REST or SQL is fine as a second view of the stored result.
- Capture the action and the state it led to, a `shot` before and after, not just the final screen.
- Check side effects too. A publish should show `POST /api/revalidate 200` in `logs/profile.log`, and the published row should be visible through `$CMS_URL/api/<plural>`.
- Read `drive.log` for `console.error` and `pageerror`. A page that looks right but logs React errors is a finding, not a pass.
- End each profile journey with an `errors` step. It sees what `next dev` saw, with the source line, and it only works while the page is open, so it must be a step, not a later call.
- Fixture rows inserted with SQL (for example, an admission cycle) are setup, never proof of the feature that would create them. Say which you did.
- Mocks are never used. Every layer is the real app, and only Google sign-in and Midtrans are out of reach.

## Cleanup

```bash
$S/stack.sh down        # or: $S/stack.sh down <run>
```

`down` kills only the process groups this run started, using the ids it saved at launch. It stops only `mbs-verify-pg-<run>`; `--rm` removes the container and its data. It then deletes the run's scratch folder. Never kill by process name, and never touch `mbs-postgres`, its `postgres-data` volume or any other container. This machine runs other projects' containers, some of them production.

`down` compares `git status` with how it looked at launch and prints a warning if anything changed. Report that warning; do not revert files yourself. If the change is `next dev` rewriting `apps/profile/AGENTS.md`, the installed Next has a new agent block: commit it rather than reverting it. The evidence folder survives `down`. Check it is still there before reporting.

## Helpers

- `stack.sh up | doctor [run] | admin [run] | env [run] | api-off [run] | api-on [run] | mail-off [run] | mail-on [run] | sim [run] -- <args> | down [run]`. `api-off` and `api-on` stop and restart only the API, for pages that must handle it being unreachable. `mail-off` and `mail-on` do the same for Mailpit, to watch the outbox retry. Mailpit keeps nothing across a restart. Without `[run]`, it uses the newest run still up that this checkout started; other agents' runs need their id, and you should never stop one. Run `stack.sh` with no arguments for usage.
- `drive.mjs --out <dir> <step>...`, as shown above. Run it with no arguments for usage.
