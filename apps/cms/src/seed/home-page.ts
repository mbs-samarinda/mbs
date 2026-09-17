/**
 * The blocks each owner's homepage starts with.
 *
 * Every string here is a placeholder with the right shape, the same status the
 * words on the design canvas have: no school has supplied copy yet. They are
 * seeded rather than left empty because the page map forbids an empty homepage,
 * and because a site nobody can look at cannot be reviewed. An editor replaces
 * them; the seed never overwrites what an editor wrote.
 *
 * Only blocks that carry their own words are here. Facilities, extracurriculars
 * and achievements are relations, and a relation is stored by document id — ids
 * that exist only after those records are created. Their sections are built at
 * boot in `index.ts` and inserted before the news block, from whatever the owner
 * actually has.
 *
 * Those records are seeded in development only, so a developer's site is not
 * blank while a real one still starts empty — an invented article, achievement
 * or building is a lie with a date on it wherever the public can read it. This
 * page row seeds everywhere, because it states nothing: it is the surface an
 * editor composes on, and its words are visibly fill-me text.
 */

import type { Modules } from "@strapi/strapi";

export type OwnerKey = "mbs" | "smp" | "smk" | "sma";

/**
 * The four keys, as a list. `Object.keys` returns `string[]` — TypeScript
 * cannot promise an object has no extra keys at runtime — so iterating the seed
 * through it needs an assertion. Writing the keys once is the cheaper honesty:
 * `HOME_SEED` is a `Record<OwnerKey, …>`, so a missing entry still fails to
 * compile.
 */
export const OWNER_KEYS: readonly OwnerKey[] = ["mbs", "smp", "smk", "sma"];

// The block shapes come from Strapi's own generated types rather than a second
// hand-written copy: a block whose fields drift from the schema then fails to
// compile here instead of failing to save at boot.
type Block = NonNullable<Modules.Documents.Params.Data.Input<"api::page.page">["blocks"]>[number];

export type HomeSeed = { title: string; blocks: Block[] };

const sectionHead = (
  heading: string,
  description: string,
  linkLabel: string,
  linkHref: string,
) => ({
  heading,
  description,
  linkLabel,
  linkHref,
});

const news = (description: string): Block => ({
  __component: "blocks.news",
  head: sectionHead("Berita & Pengumuman", description, "Lihat semua berita", "/berita"),
  limit: 3,
});

// No `admission-cta` block is seeded. The admission band is rendered by the
// page itself so an editor cannot delete the registration path, which means a
// seeded block of that type would be an editing surface that changes nothing on
// the site — an editor could rewrite it, publish, and see no difference.

// The three schools differ in their name, their headline and what their
// `program` page carries, and in nothing else at this stage.
function schoolHome(
  name: string,
  headline: string,
  sub: string,
  programs: Block,
  // What `/program` is called on this school. SMK runs jurusan; the other two
  // run programs, and naming a jurusan they do not have would be the same lie
  // as an invented achievement.
  secondaryLabel = "Lihat Program",
): HomeSeed {
  return {
    title: `Beranda ${name}`,
    blocks: [
      {
        __component: "blocks.hero",
        heading: headline,
        body: sub,
        secondaryLabel,
        secondaryHref: "/program",
      },
      {
        __component: "blocks.image-text",
        heading: "Sambutan Kepala Sekolah",
        body: `Teks sambutan kepala sekolah belum diisi. Ganti bagian ini dengan sambutan asli dari ${name}.`,
        imageSide: "awal",
      },
      programs,
      news("Terbaru lebih dulu. Pengumuman yang kedaluwarsa hilang sendiri."),
    ],
  };
}

const programsBlock = (
  heading: string,
  description: string,
  items: { title: string; description: string; points?: string }[],
): Block => ({
  __component: "blocks.programs",
  head: sectionHead(heading, description, "Lihat semua program", "/program"),
  items,
});

const PLACEHOLDER_PROGRAM = (jenjang: string) =>
  programsBlock("Program pembelajaran", `Isi bagian ini dengan program ${jenjang} yang berjalan.`, [
    { title: "Program 1", description: "Keterangan singkat program." },
    { title: "Program 2", description: "Keterangan singkat program." },
    { title: "Program 3", description: "Keterangan singkat program." },
  ]);

export const HOME_SEED: Record<OwnerKey, HomeSeed> = {
  mbs: {
    title: "Beranda Madina Boarding School",
    blocks: [
      {
        // No heading, deliberately. The umbrella's headline is its promise, and
        // the promise is `Site.tagline` — typing it here as well would be a
        // second copy of a string the brand guide says has one home. The
        // profile app falls back to the tagline when a hero carries no heading.
        __component: "blocks.hero",
        body: "Pilih jenjang yang sesuai untuk anak Anda, lalu daftar lewat satu kampanye pendaftaran bersama.",
        // An anchor, not a route: the three schools live further down this same
        // page, and the apex has no page of its own that lists them.
        secondaryLabel: "Pilih Sekolah",
        secondaryHref: "#sekolah",
      },
      {
        __component: "blocks.schools",
        head: {
          heading: "Tiga sekolah, satu naungan",
          description: "Pilih jenjang untuk membuka situs sekolahnya.",
        },
        // No link and no name on a card: both are derived from the key by the
        // profile app, because the schools sit on different hosts and a URL
        // typed here would send every local and staging visitor to production.
        items: [
          {
            school: "smp",
            meta: "Kelas VII–IX",
            description: "Pendidikan menengah pertama berasrama dengan pembinaan Al-Qur'an harian.",
          },
          {
            school: "smk",
            meta: "Kelas X–XII",
            description: "Kompetensi keahlian dengan praktik dan pembinaan asrama.",
          },
          {
            school: "sma",
            meta: "Kelas X–XII",
            description: "Persiapan perguruan tinggi dengan penguatan tahfiz dan bahasa.",
          },
        ],
      },
      {
        // Third on the page, between the schools and the foundation, which is
        // where every umbrella frame draws it. Only the sentence is seeded:
        // the heading carries the live cycle name, and the dates and fees are
        // read from the admission system.
        __component: "blocks.admission-table",
        description:
          "Satu siklus untuk tiga sekolah. Tanggal dan biaya dibaca langsung dari sistem pendaftaran.",
      },
      {
        __component: "blocks.facts",
        heading: "Di bawah Yayasan Pendidikan dan Dakwah Islam Nurul Haq",
        body: "Yayasan Pendidikan dan Dakwah Islam Nurul Haq Samarinda menaungi Madina Boarding School dan tiga sekolah di dalamnya.\n\nSetiap sekolah menjalankan kurikulum dan pembinaannya sendiri, dengan jadwal pendaftaran dan pengumuman hasil yang dikoordinasikan bersama.",
        items: [
          { label: "Sekolah", value: "SMP, SMK, SMA" },
          { label: "Model", value: "Berasrama, putra dan putri" },
          { label: "Lokasi", value: "Samarinda, Kalimantan Timur" },
        ],
      },
      news("Kabar dari ketiga sekolah, terbaru lebih dulu."),
    ],
  },
  smp: schoolHome(
    "SMP Islam Terpadu Madina",
    "Sekolah menengah berasrama yang membentuk anak saleh dan berkarakter.",
    "Isi ringkasan sekolah di sini: apa yang dijalankan setiap hari dan untuk siapa.",
    PLACEHOLDER_PROGRAM("SMP"),
  ),
  smk: schoolHome(
    "SMK Terpadu Madina",
    "Sekolah kejuruan berasrama yang membangun karakter dan keahlian.",
    "Isi ringkasan sekolah di sini: apa yang dijalankan setiap hari dan untuk siapa.",
    programsBlock(
      "Empat jurusan, satu pembinaan",
      "Setiap jurusan menjalankan praktik kejuruan penuh bersama program tahfiz dan asrama.",
      [
        {
          title: "Teknik Komputer dan Jaringan",
          description: "Jaringan, perangkat keras, dan layanan TI.",
        },
        {
          title: "Teknik Kendaraan Ringan",
          description: "Perawatan dan perbaikan kendaraan roda empat.",
        },
        {
          title: "Akuntansi dan Keuangan",
          description: "Pembukuan, pajak dasar, dan aplikasi keuangan.",
        },
        { title: "Tata Boga", description: "Produksi makanan, layanan, dan higienitas dapur." },
      ],
    ),
    "Lihat Jurusan",
  ),
  sma: schoolHome(
    "SMA Madina Citra Insani",
    "Sekolah menengah atas berasrama yang islami, unggul, dan mandiri.",
    "Isi ringkasan sekolah di sini: apa yang dijalankan setiap hari dan untuk siapa.",
    PLACEHOLDER_PROGRAM("SMA"),
  ),
};
