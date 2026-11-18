# Articles

Each site has an article section with three types: Berita (news), Pengumuman (notices) and Opini (opinion). A visitor opens it from the header's `Artikel` menu. They can list everything or one type, narrow the list to a month from the `Arsip` list, and open an article page with its date, author line and share links.

## Sub-features

- `articles-menu` is the header's `Artikel` menu button, which opens Semua artikel, Berita, Pengumuman and Opini.
- `articles-all` is `/artikel`: every type, newest first.
- `articles-type` is `/artikel/<type>`: one type only.
- `articles-archive` covers the `Arsip` month links, `?month=YYYY-MM`.
- `articles-detail` is `/artikel/<type>/<slug>`: the article page.
- `articles-missing` is an unknown slug, which answers 404.

## How to get to it (user POV)

- Choose `Artikel` in the header, then one of its links.
- Choose `Semua artikel`, `Berita`, `Pengumuman` or `Opini` in the footer's `Informasi` list.
- Choose an article card, or a month in `Arsip`.

## Driving it with drive.mjs

Preconditions:

- Baseline from the index. SMP has 4 seeded articles: 2 Berita (13 Nov and 26 Oct 2026), the Pengumuman `Perubahan jam layanan tata usaha` (16 Nov 2026), and the Opini `Belajar fisika dari dapur asrama` (15 Nov 2026, by Siti Aminah).

- **Open the menu.** Choose `Artikel` in the header. Run `drive goto:$SMP_URL/ click:button:Artikel see:link:Pengumuman shot:menu`. `menu.aria.txt` shows `button "Artikel" [expanded]` and a dialog with four links.
- **Pick a type.** Choose `Pengumuman`. Run `drive goto:$SMP_URL/ click:button:Artikel click:link:Pengumuman see:heading:Pengumuman shot:type`. The URL is `/artikel/pengumuman`, and the list holds only the notice. No Berita or Opini cards appear.
- **All articles.** Run `drive goto:$SMP_URL/artikel see:heading:Artikel shot:all`. Four cards appear, newest first, and `Arsip` shows `November 2026 (3)` and `Oktober 2026 (1)`.
- **Archive month.** Choose `Oktober 2026 (1)`. Run `drive goto:$SMP_URL/artikel "click:link:Oktober 2026 (1)" "see:heading:Perkemahan akhir semester berjalan dua hari" shot:archive`. The URL ends in `?month=2026-10`, and that is the only card.
- **Article page.** Open the opinion piece. Run `drive goto:$SMP_URL/artikel/opini/belajar-fisika-dari-dapur-asrama "see:heading:Belajar fisika dari dapur asrama" shot:detail`. The page shows `Opini 15 November 2026 · Siti Aminah, Guru Fisika` and a `Bagikan` section.
- **Unknown slug.** Run `drive goto:$SMP_URL/artikel/opini/tidak-ada shot:missing`. `drive.log` logs status 404.

## Gotchas

- At commit `82b1dda`, an unknown article slug on a school site renders Next's plain built-in 404 ("This page could not be found."), not the branded 404 that the apex shows. Report this as a finding, not a pass.
- Card accessible names are long: they hold the cover, type, date, title and summary. Click them by `/url`, using `goto`, or by the whole name copied from a snapshot.
- Article cards for another owner (collaborations, and the apex's mixed list) link to port 3002. See [Owner sites](./owner-sites.md).
- Dates are shown in Indonesian (`16 Nov 2026`, `November 2026`). Match the rendered text, not ISO dates.
