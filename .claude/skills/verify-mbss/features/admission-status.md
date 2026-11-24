# Admission status

Each school's `/pendaftaran` page tells families whether registration is open. The status, dates, fees and document list come live from the API, never from the CMS, so a stale date is never shown. The page has three honest states. With no cycle, it says the next schedule will be announced. With a cycle, it says open or closed with a badge. When the API cannot be reached, it says the status cannot be read right now.

## Sub-features

- `admission-none` covers the no-cycle state: heading `Status pendaftaran`, the line "Jadwal pendaftaran berikutnya diumumkan di halaman ini.", and `Mulai Pendaftaran` disabled.
- `admission-unavailable` covers the API-down state: "Status, tanggal, dan biaya dibaca dari sistem pendaftaran dan sedang tidak dapat dihubungi. Kami tidak menampilkan tanggal lama."
- `admission-cycle` covers a cycle's state: `Pendaftaran <name> sedang dibuka` with the `Dibuka` badge, or `sudah ditutup` with `Ditutup`.
- `admission-flow` is the fixed `Alur pendaftaran` steps: Isi data anak, Masuk akun, Lengkapi berkas, Bayar, Kirim.

## How to get to it (user POV)

- Choose `Pendaftaran` in a school's footer `Informasi` list, or `Buka halaman pendaftaran` beside the articles.
- Type `smp.localhost:3102/pendaftaran`, or the same path on `smk.` or `sma.`.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. No admission cycle exists for any school on a fresh run.

- **No-cycle state.** Open the page. Run `drive goto:$SMP_URL/pendaftaran "see:heading:Pendaftaran santri baru" "text:Jadwal pendaftaran berikutnya diumumkan di halaman ini." shot:none`. `none.aria.txt` has `heading "Status pendaftaran"` and `button "Mulai Pendaftaran" [disabled]`, and no `Dibuka` or `Ditutup` badge.
- **Flow steps.** In the same snapshot, the `Alur pendaftaran` section lists five level-3 headings in order: Isi data anak, Masuk akun, Lengkapi berkas, Bayar, Kirim.
- **API down.** Stop only this run's API, reload, then start it again. Run `stack.sh api-off`, then `drive goto:$SMP_URL/pendaftaran "text:sedang tidak dapat dihubungi" shot:unavailable`, then `stack.sh api-on`. The unavailable line shows within a few seconds and no date appears. `Mulai Pendaftaran` becomes a link to the admission app instead of a disabled button. `stack.sh doctor` passes again after `api-on`.
- **Cycle state.** Run `stack.sh sim -- cycle open` (or `upcoming`, `closed`, `none`) and reload. It is fixture setup (see Gotchas).

## Gotchas

- Creating a cycle needs a staff session, which needs Google sign-in, and the committee app is not built yet. No user path makes a cycle yet. `stack.sh sim -- cycle <state>` makes one through the domain code, so label it as fixture setup. It is not proof that cycle creation works.
- At commit `82b1dda`, an API that **hangs** (accepts the connection but never answers) makes `/pendaftaran` hang too. The oRPC call in `apps/profile/src/admission.ts` has no timeout, so the page never finishes loading. `kill -STOP` on the API reproduces it: `goto` times out after 120 s. This is a finding. Only an API that refuses connections (`api-off`) reaches the unavailable state.
- The page reads the cycle on every request (`connection()`), so no cache needs clearing between states.
- The apex has no `/pendaftaran` page. It redirects to the admission app; see [Owner sites](./owner-sites.md).
