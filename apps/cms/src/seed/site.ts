import type { OwnerKey } from "./home-page";
import { HUMAS, PPDB } from "./kontak-page";

/**
 * What each owner's site starts with.
 *
 * The tagline and the entry action come from the brand guide: every owner has a
 * tagline, and the umbrella names a joint campaign because it runs one across
 * three schools rather than taking applications of its own. Editors may reword
 * both. Where a tagline may appear stays a brand rule rather than an editor
 * choice.
 *
 * Everything else — navigation, footer columns, addresses, phone numbers — is a
 * placeholder with the right shape. No school has supplied real contact details,
 * exactly as on the design canvas. Editors replace them.
 *
 * The umbrella's links to the three school sites are deliberately absent: they
 * are the one link shape that cannot be relative, since the schools sit on
 * different hosts, and the profile application builds them from the hostname it
 * was deployed under. A production URL typed in here would send every local and
 * staging visitor to production.
 */
const ADDRESS = "Jl. Contoh Alamat No. 00, Samarinda, Kalimantan Timur 75000";
const LEGAL = "Yayasan Pendidikan dan Dakwah Islam Nurul Haq Samarinda";
const PANITIA = {
  label: "Panitia Pendaftaran",
  value: `${PPDB.phone} · WhatsApp`,
  href: PPDB.whatsapp,
};

// Official accounts, shown on a school's `/kontak` only. Placeholders like every
// other handle here: no school has confirmed which accounts are theirs.
const SOCIALS = [
  { label: "Instagram", href: "https://instagram.com/" },
  { label: "YouTube", href: "https://youtube.com/" },
  { label: "Facebook", href: "https://facebook.com/" },
];

/** The four ways into the articles, shared by the Artikel menu and the footer. */
export const ARTIKEL_LINKS = [
  { label: "Semua artikel", href: "/artikel" },
  { label: "Berita", href: "/artikel/berita" },
  { label: "Pengumuman", href: "/artikel/pengumuman" },
  { label: "Opini", href: "/artikel/opini" },
];

const ARTIKEL_MENU = { label: "Artikel", href: "/artikel", links: ARTIKEL_LINKS };

const schoolSite = (
  ownerKey: OwnerKey,
  name: string,
  subdomain: string,
  tagline: string,
  // Read off each school's own pin in Google Maps, so this is one of the few
  // seeded values that is not a placeholder. The map on `/kontak` hides itself
  // when the field is empty, which is the right default: a map centred on the
  // placeholder address would be a wrong answer rather than a missing one.
  mapsCoordinates: string,
) => ({
  ownerKey,
  tagline,
  admissionCta: "Mulai Pendaftaran",
  brandSubline: "Madina Boarding School",
  address: ADDRESS,
  mapsCoordinates,
  socials: SOCIALS,
  hours: "Senin–Jumat 07.00–15.00 WITA",
  legal: LEGAL,
  copyright: `© 2026 ${name}`,
  menu: [
    { label: "Beranda", href: "/" },
    { label: "Profil", href: "/profil" },
    { label: "Program", href: "/program" },
    { label: "Ekstrakurikuler", href: "/ekstrakurikuler" },
    { label: "Fasilitas", href: "/fasilitas" },
    { label: "Galeri", href: "/galeri" },
    ARTIKEL_MENU,
    { label: "Unduhan", href: "/unduhan" },
    { label: "Pendaftaran", href: "/pendaftaran" },
    { label: "Kontak", href: "/kontak" },
  ],
  headerPhone: { label: "0541 123456", href: "tel:+62541123456" },
  headerWhatsapp: { label: "WhatsApp Panitia", href: PANITIA.href },
  footerColumns: [
    {
      heading: "Jelajahi",
      links: [
        { label: "Profil", href: "/profil" },
        { label: "Program", href: "/program" },
        { label: "Ekstrakurikuler", href: "/ekstrakurikuler" },
        { label: "Fasilitas", href: "/fasilitas" },
        { label: "Galeri", href: "/galeri" },
      ],
    },
    {
      heading: "Informasi",
      links: [
        ...ARTIKEL_LINKS,
        { label: "Unduhan", href: "/unduhan" },
        { label: "Pendaftaran", href: "/pendaftaran" },
        { label: "Kontak", href: "/kontak" },
      ],
    },
  ],
  contacts: [
    PANITIA,
    { label: "Humas Sekolah", value: `${HUMAS.phone} · WhatsApp`, href: HUMAS.whatsapp },
    {
      label: "Email",
      value: `halo@${subdomain}.mbss.sch.id`,
      href: `mailto:halo@${subdomain}.mbss.sch.id`,
    },
  ],
});

export const OWNER_SEED = [
  {
    ownerKey: "mbs" as OwnerKey,
    tagline: "Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing",
    admissionCta: "Pendaftaran Bersama",
    brandSubline: "Samarinda",
    address: ADDRESS,
    hours: "Senin–Jumat 07.00–15.00 WITA",
    legal: LEGAL,
    copyright: "© 2026 Madina Boarding School Samarinda",
    // The apex has no pages besides its home, so nothing to navigate to. The
    // school switcher and the footer's school column are built in code.
    menu: [],
    footerColumns: [],
    contacts: [
      PANITIA,
      { label: "Sekretariat Yayasan", value: "0541 123456", href: "tel:+62541123456" },
      { label: "Email", value: "halo@mbss.sch.id", href: "mailto:halo@mbss.sch.id" },
    ],
  },
  // The names match `packages/school-config`, which is what the header renders.
  // A shorter form here would put two names for one school on one page.
  schoolSite(
    "smp",
    "SMP Islam Terpadu Madina",
    "smp",
    "Sekolahnya Anak Saleh, Unggul & Berkarakter",
    "-0.4667789,117.1949594",
  ),
  schoolSite(
    "smk",
    "SMK Terpadu Madina",
    "smk",
    "Berakhlak Mulia Siap Berkarya",
    "-0.4750085,117.2068342",
  ),
  schoolSite(
    "sma",
    "SMA Madina Citra Insani",
    "sma",
    "Islami Unggul Mandiri",
    "-0.4656565,117.1953527",
  ),
];
