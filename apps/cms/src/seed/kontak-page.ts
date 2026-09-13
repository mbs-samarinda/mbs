/**
 * The blocks each owner's `/kontak` page starts with.
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

const schoolKontak = (name: string, subdomain: string): KontakSeed => ({
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
          channelValue: "0812 0000 0000",
          channelHref: "https://wa.me/628120000000",
          ctaLabel: "Chat di WhatsApp",
          hours: HOURS,
          email: `ppdb@${subdomain}.mbss.sch.id`,
        },
        {
          title: "Tanya humas sekolah",
          description: "Kunjungan, kerja sama, dan pertanyaan umum lainnya.",
          channelValue: "0812 1111 1111",
          channelHref: "https://wa.me/628121111111",
          ctaLabel: "Chat di WhatsApp",
          hours: HOURS,
          email: `humas@${subdomain}.mbss.sch.id`,
        },
      ],
    },
  ],
});

export const KONTAK_SEED: Record<OwnerKey, KontakSeed> = {
  mbs: {
    title: "Kontak Madina Boarding School",
    blocks: [
      {
        __component: "blocks.contact",
        head: {
          heading: "Kontak tiap sekolah",
          description:
            "Pertanyaan tentang program, asrama, atau kegiatan ditangani sekolah masing-masing.",
        },
        showMap: true,
        items: [
          {
            title: "Panitia pendaftaran bersama",
            description: "Syarat, jadwal, biaya, dan status berkas untuk ketiga sekolah.",
            channelValue: "0812 0000 0000",
            channelHref: "https://wa.me/628120000000",
            ctaLabel: "Chat di WhatsApp",
            hours: HOURS,
            email: "ppdb@mbss.sch.id",
          },
          {
            title: "Sekretariat yayasan",
            description: "Kerja sama, kunjungan, dan urusan organisasi.",
            channelValue: "0541 123456",
            channelHref: "tel:+62541123456",
            ctaLabel: "Telepon sekretariat",
            hours: HOURS,
            email: "halo@mbss.sch.id",
          },
        ],
      },
    ],
  },
  smp: schoolKontak("SMP Islam Terpadu Madina", "smp"),
  smk: schoolKontak("SMK Terpadu Madina", "smk"),
  sma: schoolKontak("SMA Madina Citra Insani", "sma"),
};
