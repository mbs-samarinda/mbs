# Owner sites

One profile app serves four sites. The apex is Madina Boarding School, the umbrella, and `smp.`, `smk.` and `sma.` are the three schools. Each hostname gets its own name, palette and content, and never another owner's. The apex has only its home and its own articles, so any other path there shows a branded 404 page ("Halaman ini tidak ada di situs Madina Boarding School"; the tab title says "Halaman tidak ditemukan").

## Sub-features

- `owner-apex` serves the umbrella home at the bare apex.
- `owner-school` serves each school's own home on its subdomain.
- `owner-www` redirects `www.<host>` to the bare host with a 308.
- `owner-unknown` answers an unknown subdomain with a plain 404, "Unknown owner host".
- `owner-apex-404` shows the branded 404 for a school-only path on the apex.
- `owner-apex-pendaftaran` sends the apex's `/pendaftaran` to the admission app with a 307.
- `owner-switcher` is the header's `Situs MBSS` navigation, which links SMP, SMK and SMA.

## How to get to it (user POV)

- Type a site address: `localhost`, `smp.localhost`, `smk.localhost` or `sma.localhost`, all on the run's profile port.
- Choose `SMP`, `SMK` or `SMA` in the header's `Situs MBSS` navigation.
- Choose the apex header's `Pendaftaran Bersama` button.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. `stack.sh doctor` passes.

- **Apex home.** Open the apex. Run `drive goto:$APEX_URL/ "text:Madina Boarding School" shot:apex`. Status 200, and the header and title name Madina Boarding School.
- **Each school.** Open each subdomain. Run `drive goto:$SMP_URL/ "text:SMP Islam Terpadu Madina" shot:smp goto:$SMK_URL/ "text:SMK Terpadu Madina" shot:smk goto:$SMA_URL/ "text:SMA Madina Citra Insani" shot:sma`. Each page names only its own school in the title and footer, and the screenshots show different palettes.
- **www redirect.** Run `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H "Host: www.smp.localhost:$PROFILE_PORT" http://127.0.0.1:$PROFILE_PORT/profil`. Output: `308 https://smp.localhost/profil`.
- **Unknown host.** Run `curl -s -w ' %{http_code}\n' -H "Host: nope.localhost:$PROFILE_PORT" http://127.0.0.1:$PROFILE_PORT/`. Output: `Unknown owner host 404`.
- **Apex branded 404.** Open a school-only path on the apex. Run `drive goto:$APEX_URL/profil "see:heading:Halaman ini tidak ada di situs Madina Boarding School" see:link:Kembali ke Beranda shot:apex-404`. `drive.log` shows status 404, and the page keeps the site header, not Next's plain "This page could not be found.".
- **Apex pendaftaran.** Run `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H "Host: localhost:$PROFILE_PORT" http://127.0.0.1:$PROFILE_PORT/pendaftaran`. Output: `307 http://localhost:5173/`.
- **Switcher.** Snapshot the header. Run `drive goto:$SMP_URL/ shot:switcher`. `switcher.aria.txt` has `navigation "Situs MBSS"` with links `SMP`, `SMK` and `SMA`, and their `/url` values name each subdomain.

## Gotchas

- Cross-owner links are hard-coded to port **3002**, the dev port (`ownerUrl` in `apps/profile/src/owners.ts`). That includes the switcher, other owners' article cards and the apex's school links. Clicking one leaves the verify stack and may land on the user's own dev server. Check the link's `/url` in the snapshot, then `goto` the same path on `$PROFILE_PORT`.
- The `www.` redirect always goes to `https://` with no port, which nothing serves locally. Assert the `Location` header and do not follow it.
- The `/pendaftaran` redirect lands on `localhost:5173`, the parent app. Follow it only when the stack runs that app on its default port.
- Next renders a page on its first request. The first visit to each route can take 5–20 s.
