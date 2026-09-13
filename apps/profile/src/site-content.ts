import { SCHOOLS, type School } from "@mbs/school-config";

import { ownerUrl, type Owner } from "./owners.ts";

/** A navigation or footer link. Paths are relative; another owner is absolute. */
type Link = { readonly label: string; readonly href: string };

/** A contact row: the channel is the label, the number or address is the value. */
type Contact = Link & { readonly value: string };

/**
 * The shell's words and links, one set per owner.
 *
 * This module is where the CMS lands. Navigation, footer content, the tagline
 * and the contact details are all editor-owned, so every value below is a
 * placeholder standing in until Strapi holds them — the same shape, read from
 * one place, so the swap is a change of source rather than a rewrite of the
 * shell.
 *
 * The addresses and phone numbers are invented, exactly as the ones on the
 * design canvas are. No school has supplied real ones yet.
 */
export type SiteContent = {
  /** The small line under the owner's name in the header and footer. */
  readonly brandSubline: string;
  /**
   * The umbrella promise, and umbrella surfaces only. A school carries its own
   * tagline elsewhere and never on the same surface as this one, so every
   * school is null here.
   */
  readonly tagline: string | null;
  readonly address: string;
  readonly hours: string | null;
  readonly legal: string;
  readonly copyright: string;
  /**
   * The entry action's label. A school says what it is — start your
   * registration. The umbrella runs one campaign across three schools, so it
   * names that instead of implying the apex takes applications of its own.
   */
  readonly admissionCta: string;
  readonly nav: readonly Link[];
  /** The two numbers a parent asks on. The umbrella has neither of its own. */
  readonly headerContact: { readonly phone: Link; readonly whatsapp: Link } | null;
  readonly footerColumns: readonly {
    readonly heading: string;
    readonly items: readonly Link[];
  }[];
  readonly contacts: readonly Contact[];
};

const LEGAL = "Yayasan Pendidikan dan Dakwah Islam Nurul Haq Samarinda";
const ADDRESS = "Jl. Contoh Alamat No. 00, Samarinda, Kalimantan Timur 75000";
const PANITIA = {
  label: "Panitia Pendaftaran",
  value: "0812 0000 0000 · WhatsApp",
  href: "https://wa.me/628120000000",
} as const;

// The three school sites differ only in their name and their own email, so they
// are built rather than written out three times.
function schoolContent(school: School): SiteContent {
  const email = `halo@${school.subdomain}.mbss.sch.id`;

  return {
    brandSubline: "Madina Boarding School",
    tagline: null,
    address: ADDRESS,
    hours: "Senin–Jumat 07.00–15.00 WITA",
    legal: LEGAL,
    copyright: `© 2026 ${school.name}`,
    admissionCta: "Mulai Pendaftaran",
    nav: [
      { label: "Beranda", href: "/" },
      { label: "Profil", href: "/profil" },
      { label: "Program", href: "/program" },
      { label: "Ekstrakurikuler", href: "/ekstrakurikuler" },
      { label: "Fasilitas", href: "/fasilitas" },
      { label: "Berita", href: "/berita" },
      { label: "Pendaftaran", href: "/pendaftaran" },
      { label: "Kontak", href: "/kontak" },
    ],
    headerContact: {
      phone: { label: "0541 123456", href: "tel:+62541123456" },
      whatsapp: { label: "WhatsApp Panitia", href: PANITIA.href },
    },
    footerColumns: [
      {
        heading: "Jelajahi",
        items: [
          { label: "Profil", href: "/profil" },
          { label: "Program", href: "/program" },
          { label: "Ekstrakurikuler", href: "/ekstrakurikuler" },
          { label: "Fasilitas", href: "/fasilitas" },
        ],
      },
      {
        heading: "Informasi",
        items: [
          { label: "Berita & Pengumuman", href: "/berita" },
          { label: "Pendaftaran", href: "/pendaftaran" },
          { label: "Kontak", href: "/kontak" },
        ],
      },
    ],
    contacts: [
      PANITIA,
      {
        label: "Humas Sekolah",
        value: "0812 1111 1111 · WhatsApp",
        href: "https://wa.me/628121111111",
      },
      { label: "Email", value: email, href: `mailto:${email}` },
    ],
  };
}

const UMBRELLA_CONTENT: SiteContent = {
  brandSubline: "Samarinda",
  // The enduring promise belongs on umbrella surfaces only; a school carries its
  // own tagline in this slot instead, and never both on one surface.
  tagline: "Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing",
  address: ADDRESS,
  hours: null,
  legal: LEGAL,
  copyright: "© 2026 Madina Boarding School Samarinda",
  admissionCta: "Pendaftaran Bersama",
  nav: [
    { label: "Beranda", href: "/" },
    { label: "Profil", href: "/profil" },
    { label: "Pendaftaran", href: "/pendaftaran" },
    { label: "Berita", href: "/berita" },
    { label: "Kontak", href: "/kontak" },
  ],
  headerContact: null,
  footerColumns: [
    {
      heading: "Sekolah",
      items: SCHOOLS.map((school) => ({ label: school.name, href: ownerUrl(school) })),
    },
    {
      heading: "Informasi",
      items: [
        { label: "Profil yayasan", href: "/profil" },
        { label: "Pendaftaran bersama", href: "/pendaftaran" },
        { label: "Berita & Pengumuman", href: "/berita" },
        { label: "Kontak", href: "/kontak" },
      ],
    },
  ],
  contacts: [
    PANITIA,
    { label: "Sekretariat Yayasan", value: "0541 123456", href: "tel:+62541123456" },
    { label: "Email", value: "halo@mbss.sch.id", href: "mailto:halo@mbss.sch.id" },
  ],
};

// The three schools are indexed by position, which `Record` cannot check: a
// reorder of `SCHOOLS` would quietly serve one school's name and email on
// another's host. A test asserts each entry describes the school it is keyed by.
export const SITE_CONTENT: Record<Owner["key"], SiteContent> = {
  mbs: UMBRELLA_CONTENT,
  smp: schoolContent(SCHOOLS[0]),
  smk: schoolContent(SCHOOLS[1]),
  sma: schoolContent(SCHOOLS[2]),
};
