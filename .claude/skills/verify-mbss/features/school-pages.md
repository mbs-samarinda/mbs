# School pages

Each school site has a home page and a fixed set of section pages, linked from the header's `Halaman` navigation and the footer's `Jelajahi` list. Every page's text comes from the CMS. Sections with entries (ekstrakurikuler, fasilitas) list cards that open a detail page. Sections with no published entries (galeri, unduhan) show one short empty-state line instead.

## Sub-features

- `pages-home` is the school home at `/`.
- `pages-nav` covers the `Halaman` links: Beranda, Profil, Program, Ekstrakurikuler, Fasilitas, Galeri, Unduhan, plus the `Artikel` menu button. See [Articles](./articles.md).
- `pages-list` covers section pages that list cards: ekstrakurikuler and fasilitas.
- `pages-detail` is a card's detail page, `/<section>/<slug>`.
- `pages-empty` is the empty state of galeri and unduhan.
- `pages-kontak` is the contact page, with phone, WhatsApp and email links.

## How to get to it (user POV)

- Choose a link in the header's `Halaman` navigation.
- Choose a link in the footer's `Jelajahi` or `Informasi` lists.
- Choose a card on a section page to open its detail page.
- Type the path directly, for example `smp.localhost:3102/fasilitas`.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. The seed has SMP ekstrakurikuler `Futsal` and fasilitas `Asrama santri`, and no albums or files.

- **Header link.** From the home page, choose `Profil`. Run `drive goto:$SMP_URL/ shot:home click:link:Profil "see:heading:Profil SMP Islam Terpadu Madina" shot:profil`. The URL ends in `/profil`, and the level-1 heading names the school.
- **Each section.** Open every section page. Run `drive goto:$SMP_URL/program "see:heading:Program akademik" goto:$SMP_URL/ekstrakurikuler see:heading:Ekstrakurikuler goto:$SMP_URL/fasilitas see:heading:Fasilitas goto:$SMP_URL/kontak see:heading:Kontak shot:kontak`. Every step passes, with status 200 each time.
- **List to detail.** Open a fasilitas card. Run `drive goto:$SMP_URL/fasilitas "see:heading:Asrama santri" shot:fasilitas goto:$SMP_URL/fasilitas/asrama-santri "see:heading:Asrama santri" shot:fasilitas-detail`. The card's `/url` in `fasilitas.aria.txt` is `/fasilitas/asrama-santri`, and the detail page's heading matches the card. To click the card instead, use its whole accessible name from the snapshot, which starts with `Foto`.
- **Empty states.** Run `drive goto:$SMP_URL/galeri "text:Belum ada album yang dipublikasikan." shot:galeri goto:$SMP_URL/unduhan "text:Belum ada berkas yang dipublikasikan." shot:unduhan`. Each page shows its line, and no broken grid appears.
- **Contact links.** Run `drive goto:$SMP_URL/kontak shot:kontak`. `kontak.aria.txt` has `tel:` and `https://wa.me/` links and a `mailto:` link for `halo@smp.mbss.sch.id`.
- **Mobile.** Repeat any step with `--mobile`. The header turns into its mobile menu, and the `.aria.txt` still reaches the same links.

## Gotchas

- At commit `82b1dda`, every SMP page logs a React `console.error`: "Encountered two children with the same key" for `https://wa.me/6282155865420`. Report it as a known finding. Do not treat it as noise.
- Card links have long accessible names, made of photo, title, description and schedule. Use the `/url` from the snapshot, or copy the whole name exactly. Do not guess it.
- The `Artikel` header entry is a menu button, not a link. Its own recipe is in [Articles](./articles.md).
- The apex has none of these pages. On the apex they return the branded 404. See [Owner sites](./owner-sites.md).
- With no admission cycle, the green `Pendaftaran santri baru` band at the bottom of school pages shows five empty grey pills that have no text in the accessibility tree. It is not yet known whether they are the designed no-cycle look or a loading skeleton that never resolves. Check `apps/profile` before you call it either a pass or a bug.
