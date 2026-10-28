/**
 * The blocks each school's `/profil` page starts with.
 *
 * The page map gives this route four jobs — identity, history, values,
 * leadership. Each is its own block so an editor can reorder or drop one; none
 * of them is code.
 *
 * Every string is a placeholder with the right shape, like the rest of the
 * seeds. The legal name of the yayasan is the exception: it is a fact about the
 * organisation, and it already appears in the brand guide.
 *
 * Pencapaian is not here. It is a relation, stored by document id, so its
 * section is built at boot in `index.ts` from whatever records the owner has —
 * the same reason the homepage's three relation sections are not in `HOME_SEED`.
 */

import type { Modules } from "@strapi/strapi";

import type { OwnerKey } from "./home-page";

type Block = NonNullable<Modules.Documents.Params.Data.Input<"api::page.page">["blocks"]>[number];

export type ProfilSeed = { title: string; blocks: Block[] };

const YAYASAN = "Yayasan Pendidikan dan Dakwah Islam Nurul Haq Samarinda";
const ALAMAT = "Jl. Contoh Alamat No. 00, Samarinda";

const timeline = (heading: string, description: string, items: [number, string][]): Block => ({
  __component: "blocks.timeline",
  head: { heading, description },
  items: items.map(([year, body]) => ({ year, body })),
});

/** The four values are the same four on every school; only the wording differs. */
const VALUES: Block = {
  __component: "blocks.values",
  head: {
    heading: "Nilai yang dipegang",
    description: "Empat hal yang dipakai untuk menilai keputusan sehari-hari.",
  },
  items: [
    {
      icon: "kitab",
      title: "Qur'ani",
      description: "Hafalan dan adab jadi bagian jadwal harian, bukan tambahan.",
    },
    {
      icon: "perisai",
      title: "Disiplin",
      description: "Jadwal asrama, kelas, dan kegiatan dijalankan konsisten.",
    },
    {
      icon: "kunci",
      title: "Terampil",
      description: "Setiap program berbasis praktik dan pendampingan.",
    },
    {
      icon: "tangan",
      title: "Peduli",
      description: "Pembina mendampingi santri secara personal.",
    },
  ],
};

/**
 * Four roles, no names. A name and a photo are a claim about a real person, so
 * the seed leaves both as fill-me text for the school to replace.
 */
const PEOPLE: Block = {
  __component: "blocks.people",
  head: { heading: "Kepemimpinan", description: "Nama dan foto diisi editor sekolah." },
  items: [
    { name: "Nama Lengkap", role: "Kepala Sekolah" },
    { name: "Nama Lengkap", role: "Wakil Kurikulum" },
    { name: "Nama Lengkap", role: "Wakil Kesiswaan" },
    { name: "Nama Lengkap", role: "Kepala Asrama" },
  ],
};

const schoolProfil = (name: string, jenjang: string, kelas: string, lead: string): ProfilSeed => ({
  title: `Profil ${name}`,
  blocks: [
    {
      __component: "blocks.facts",
      heading: lead,
      body: `Isi bagian ini dengan ringkasan ${name}: apa yang dijalankan setiap hari dan untuk siapa.\n\nSekolah ini bagian dari Madina Boarding School, di bawah ${YAYASAN}.`,
      items: [
        { label: "Jenjang", value: `${jenjang} · Kelas ${kelas}` },
        { label: "Asrama", value: "Putra dan putri, terpisah" },
        { label: "Naungan", value: "Madina Boarding School" },
        { label: "Alamat", value: ALAMAT },
      ],
    },
    timeline("Sejarah singkat", "Ditulis dan diperbarui editor sekolah di CMS.", [
      [2008, "Yayasan Nurul Haq membuka pesantren putra pertama di Samarinda."],
      [2026, "Isi tahun dan peristiwa berikutnya di CMS."],
    ]),
    VALUES,
    PEOPLE,
  ],
});

// Schools only: the apex has no `/profil`.
export const PROFIL_SEED: Record<Exclude<OwnerKey, "mbs">, ProfilSeed> = {
  smp: schoolProfil(
    "SMP Islam Terpadu Madina",
    "SMP",
    "VII–IX",
    "Sekolah menengah berasrama di bawah Madina Boarding School",
  ),
  smk: schoolProfil(
    "SMK Terpadu Madina",
    "SMK",
    "X–XII",
    "Sekolah kejuruan berasrama di bawah Madina Boarding School",
  ),
  sma: schoolProfil(
    "SMA Madina Citra Insani",
    "SMA",
    "X–XII",
    "Sekolah menengah atas berasrama di bawah Madina Boarding School",
  ),
};
