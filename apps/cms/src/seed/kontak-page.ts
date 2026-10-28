/**
 * The blocks each school's `/kontak` page starts with.
 *
 * Asking is the most-used path on the old site by a wide margin — its two
 * question forms beat every content page — so the two ways to ask are the
 * page's own content rather than a line in the footer. They are separated the
 * way the old forms were: the admission committee answers about the intake, and
 * somebody else answers everything else.
 *
 * Address, hours, socials and the map come from the `Site` row instead, because
 * they are facts about the owner rather than words on this page.
 *
 * Numbers and addresses here are placeholders with the right shape, like every
 * other seed. Editors replace them; the seed never overwrites what they wrote.
 */

import type { Modules } from "@strapi/strapi";

import type { OwnerKey } from "./home-page";

type Block = NonNullable<Modules.Documents.Params.Data.Input<"api::page.page">["blocks"]>[number];

export type KontakSeed = { title: string; blocks: Block[] };

const HOURS = "Senin–Jumat 08.00–15.00 WITA";

/**
 * The admission committee and humas serve all three schools, so every school
 * starts with the same two. Each school's row can still be changed on its own.
 * `index.ts` reads these too, for the footer and header contacts.
 */
export const PPDB = {
  phone: "0812 0000 0000",
  whatsapp: "https://wa.me/628120000000",
  email: "ppdb@mbss.sch.id",
};

export const HUMAS = {
  phone: "0812 1111 1111",
  whatsapp: "https://wa.me/628121111111",
  email: "humas@mbss.sch.id",
};

const schoolKontak = (name: string): KontakSeed => ({
  title: `Kontak ${name}`,
  blocks: [
    {
      __component: "blocks.contact",
      head: {
        heading: "Alamat dan jam layanan",
        description: "Datang pada jam kerja; di luar itu hubungi WhatsApp.",
      },
      showMap: true,
      items: [
        {
          title: "Tanya panitia pendaftaran",
          description: "Syarat, biaya, jadwal seleksi, dan status berkas anak Anda.",
          channelValue: PPDB.phone,
          channelHref: PPDB.whatsapp,
          ctaLabel: "Chat di WhatsApp",
          hours: HOURS,
          email: PPDB.email,
        },
        {
          title: "Tanya humas sekolah",
          description: "Kunjungan, kerja sama, dan pertanyaan umum lainnya.",
          channelValue: HUMAS.phone,
          channelHref: HUMAS.whatsapp,
          ctaLabel: "Chat di WhatsApp",
          hours: HOURS,
          email: HUMAS.email,
        },
      ],
    },
  ],
});

// Schools only: the apex has no such page.
export const KONTAK_SEED: Partial<Record<OwnerKey, KontakSeed>> = {
  smp: schoolKontak("SMP Islam Terpadu Madina"),
  smk: schoolKontak("SMK Terpadu Madina"),
  sma: schoolKontak("SMA Madina Citra Insani"),
};
