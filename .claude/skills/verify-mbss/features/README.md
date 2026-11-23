# MBSS verification map

This folder is the maintained source for verifying what MBSS visitors and editors can do. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- A stack started by `stack.sh up` in this run, with `stack.sh doctor` passing. Never drive an instance this run did not start, including the user's `pnpm dev` on ports 3002/1337/3001/5173/5174.
- `eval "$(.claude/skills/verify-mbss/stack.sh env)"` sets `APEX_URL`, `SMP_URL`, `SMK_URL`, `SMA_URL`, `CMS_URL`, `API_URL`, `ADMISSION_URL`, `ADMIN_URL`, `MAIL_URL`, `EVIDENCE` and `REVALIDATE_SECRET`.
- The data is the CMS seed, which is the same on every fresh run. Each owner has a Site row and every page. SMP has four articles, including the Pengumuman `Perubahan jam layanan tata usaha`, plus ekstrakurikuler (`Futsal`, ...) and fasilitas (`Asrama santri`, ...). No albums or files are seeded. No admission cycle exists.
- For Strapi journeys, run `stack.sh admin` once per run. It creates the login `verify@mbss.test` with the password `Verify-mbss-1`.

## Driving conventions

- Browser steps go through `node .claude/skills/verify-mbss/drive.mjs --out "$EVIDENCE/<feature-id>" <step>...`. Below, `drive` is short for that command.
- Find handles by ARIA role and exact accessible name from a `shot`'s `.aria.txt`. Never use CSS classes or positions.
- curl is fine for status codes, redirects and headers. Send the host as a header: `curl -H "Host: smp.localhost:$PROFILE_PORT" http://127.0.0.1:$PROFILE_PORT/...`.
- Content changes made for a journey stay in the throwaway database and disappear at `down`. No restore step is needed.
- In zsh, never name a loop variable `path`. It is tied to `PATH` and wipes it.

## Proof and skip reporting

- Save a `shot` before and after each action. Keep `drive.log`: it lists every console error and failed request.
- A React `console.error` or a `pageerror` on a page is a finding even when the page looks right.
- A change made in Strapi needs a second, read-only view: the profile page, plus `$CMS_URL/api/<plural>` with the read token or the `POST /api/revalidate` line in `logs/profile.log`.
- Name the feature ID and the entry point next to each artifact. If an entry point cannot be reached, report the command you tried and the missing precondition. Never report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph about what the user sees. Then come exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs`, `Gotchas`. The driving section starts with `Preconditions:`, then labeled bullets that each pair a user action with an exact command and the observable result.

## Features

- [Owner sites](./owner-sites.md): one app, four sites by hostname. Covers the apex, the school subdomains, the `www.` redirect, unknown hosts and the apex's branded 404.
- [School pages](./school-pages.md): a school's home and its section pages from the header navigation, with their detail pages and empty states.
- [Articles](./articles.md): the article list, its type filters and archive, and an article page.
- [Admission status](./admission-status.md): the `pendaftaran` page reading the live cycle from the API, in its no-cycle and API-down states.
- [Family sign-in](./family-sign-in.md): the parent app, by email code or Google, its guard and its refusals.
- [Committee sign-in](./committee-sign-in.md): the committee app, its dashboard and the two ways it refuses an account.
- [CMS publish](./cms-publish.md): an editor changes content in Strapi, publishes, and the profile site shows it without waiting out the cache.
