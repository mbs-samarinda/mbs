/**
 * The blocks each owner's `/profil` page starts with.
 *
 * The page map gives this route four jobs on a school — identity, history,
 * values, leadership — and three at the apex, where "history" is the yayasan's
 * and the middle one is the structure behind the name. Each is its own block so
 * an editor can reorder or drop one; none of them is code.
 *
 * Every string is a placeholder with the right shape, like the rest of the
 * seeds. Two exceptions state something real because they are facts about the
 * organisation rather than about a school's daily life: the legal name of the
 * yayasan and the three layers under it. Both already appear in the brand guide.
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

export const PROFIL_SEED: Record<OwnerKey, ProfilSeed> = {
  mbs: {
    title: "Profil Madina Boarding School",
    blocks: [
      {
        __component: "blocks.facts",
        heading: YAYASAN,
        body: `Yayasan berdiri di Samarinda dan bergerak di pendidikan dan dakwah. Madina Boarding School adalah nama publik untuk sekolah-sekolah yang dinaunginya.\n\nMadina Boarding School bukan sekolah keempat. Ia payung bagi SMP Islam Terpadu Madina, SMK Terpadu Madina, dan SMA Madina Citra Insani.`,
        items: [
          { label: "Nama legal", value: YAYASAN },
          { label: "Nama publik", value: "Madina Boarding School Samarinda" },
          { label: "Berdiri", value: "2008" },
          { label: "Alamat", value: ALAMAT },
        ],
      },
      {
        __component: "blocks.layers",
        head: {
          heading: "Struktur",
          description: "Tiga lapis identitas: yayasan, payung, lalu sekolah.",
        },
        items: [
          { title: YAYASAN, description: "Identitas legal dan organisasi." },
          {
            title: "Madina Boarding School",
            description: "Payung publik untuk sekolah dan kampanye pendaftaran bersama.",
          },
          {
            title: "SMP IT Madina · SMK Terpadu Madina · SMA MCI",
            description: "Tiap sekolah memimpin situs dan kegiatannya sendiri.",
          },
        ],
      },
      timeline("Perjalanan singkat", "Ditulis administrator konten yayasan.", [
        [2008, "Yayasan berdiri dan membuka pesantren putra pertama."],
        [2012, "SMP Islam Terpadu Madina menerima angkatan pertama."],
        [2014, "SMK Terpadu Madina berdiri."],
        [2019, "SMA Madina Citra Insani melengkapi tiga jenjang."],
      ]),
    ],
  },
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
