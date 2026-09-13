import type { Core } from "@strapi/strapi";

import { HOME_SEED, OWNER_KEYS, type HomeSeed, type OwnerKey } from "./seed/home-page";
import { ADMISSION_SEED, type AdmissionSeed } from "./seed/pendaftaran-page";

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
  value: "0812 0000 0000 · WhatsApp",
  href: "https://wa.me/628120000000",
};

const schoolSite = (ownerKey: OwnerKey, name: string, subdomain: string, tagline: string) => ({
  ownerKey,
  tagline,
  admissionCta: "Mulai Pendaftaran",
  brandSubline: "Madina Boarding School",
  address: ADDRESS,
  hours: "Senin–Jumat 07.00–15.00 WITA",
  legal: LEGAL,
  copyright: `© 2026 ${name}`,
  navigation: [
    { label: "Beranda", href: "/" },
    { label: "Profil", href: "/profil" },
    { label: "Program", href: "/program" },
    { label: "Ekstrakurikuler", href: "/ekstrakurikuler" },
    { label: "Fasilitas", href: "/fasilitas" },
    { label: "Berita", href: "/berita" },
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
      ],
    },
    {
      heading: "Informasi",
      links: [
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
    {
      label: "Email",
      value: `halo@${subdomain}.mbss.sch.id`,
      href: `mailto:halo@${subdomain}.mbss.sch.id`,
    },
  ],
});

const OWNER_SEED = [
  {
    ownerKey: "mbs" as OwnerKey,
    tagline: "Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing",
    admissionCta: "Pendaftaran Bersama",
    brandSubline: "Samarinda",
    address: ADDRESS,
    legal: LEGAL,
    copyright: "© 2026 Madina Boarding School Samarinda",
    navigation: [
      { label: "Beranda", href: "/" },
      { label: "Profil", href: "/profil" },
      { label: "Pendaftaran", href: "/pendaftaran" },
      { label: "Berita", href: "/berita" },
      { label: "Kontak", href: "/kontak" },
    ],
    footerColumns: [
      {
        heading: "Informasi",
        links: [
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
  },
  // The names match `packages/school-config`, which is what the header renders.
  // A shorter form here would put two names for one school on one page.
  schoolSite(
    "smp",
    "SMP Islam Terpadu Madina",
    "smp",
    "Sekolahnya Anak Saleh, Unggul & Berkarakter",
  ),
  schoolSite("smk", "SMK Terpadu Madina", "smk", "Berakhlak Mulia Siap Berkarya"),
  schoolSite("sma", "SMA Madina Citra Insani", "sma", "Islami Unggul Mandiri"),
];

/**
 * What the profile sites read. Every one of these is already published content —
 * it is on a public website the moment an editor publishes it — so the Public
 * role reads them and no token exists to rotate or to leave out of a fresh
 * clone. Reading is all that is granted: nothing here creates, updates, or
 * deletes.
 */
const PUBLIC_READ = [
  "api::site.site",
  "api::page.page",
  "api::berita.berita",
  "api::pengumuman.pengumuman",
  "api::ekstrakurikuler.ekstrakurikuler",
  "api::fasilitas.fasilitas",
  "api::pencapaian.pencapaian",
] as const;

async function grantPublicRead(strapi: Core.Strapi) {
  const role: { id: number } | null = await strapi.db
    .query("plugin::users-permissions.role")
    .findOne({ where: { type: "public" }, select: ["id"] });

  if (!role) {
    strapi.log.warn("No public role yet; skipping public read permissions this boot.");
    return;
  }

  for (const uid of PUBLIC_READ) {
    for (const verb of ["find", "findOne"]) {
      const action = `${uid}.${verb}`;
      const existing = await strapi.db
        .query("plugin::users-permissions.permission")
        .findOne({ where: { action, role: role.id }, select: ["id"] });

      if (existing) continue;
      await strapi.db
        .query("plugin::users-permissions.permission")
        .create({ data: { action, role: role.id } });
    }
  }
}

/**
 * Gives every owner a Site row on first start, so no site is served without an
 * identity and no editor has to know which four keys exist.
 *
 * It creates what is missing and never touches what is there. An earlier
 * version filled in fields that were empty on an existing row, so that adding a
 * field to this seed would reach databases that already had rows. That is the
 * wrong trade: a school that deletes the placeholder opening hours because it
 * does not publish fixed ones would get them back on the next restart, and a
 * wrong factual claim republished on a school's own website is worse than a
 * field that needs filling in once by hand. `Site` has no draft buffer, so
 * there would be no stage to catch it on either.
 */
async function seedSites(strapi: Core.Strapi) {
  for (const seed of OWNER_SEED) {
    const existing = await strapi
      .documents("api::site.site")
      .findFirst({ filters: { ownerKey: seed.ownerKey } });

    if (existing) continue;

    try {
      await strapi.documents("api::site.site").create({ data: seed });
    } catch (error) {
      // Two instances booting together both read no row and both create one;
      // the loser hits the unique key on ownerKey. That is the constraint doing
      // its job. Anything else — a renamed field, a validation rule — must not
      // be swallowed: without a Site row every profile page throws, and a boot
      // that logs "another instance did it" would send us looking at the wrong
      // machine. So the claim is checked rather than assumed.
      const winner = await strapi
        .documents("api::site.site")
        .findFirst({ filters: { ownerKey: seed.ownerKey } });

      if (!winner) throw error;
      strapi.log.info(`Site row for ${seed.ownerKey} already created by another instance.`);
    }
  }
}

/**
 * Gives every owner a published page on first start. The page map forbids an
 * empty homepage, and a `Page` row is one per route rather than something an
 * editor creates, so the row has to come from somewhere. Same rule as the sites:
 * create what is missing, never touch what is there.
 */
async function seedPages(
  strapi: Core.Strapi,
  slug: "home" | "pendaftaran",
  seeds: Record<OwnerKey, HomeSeed | AdmissionSeed>,
) {
  for (const ownerKey of OWNER_KEYS) {
    const seed = seeds[ownerKey];
    const existing = await strapi
      .documents("api::page.page")
      .findFirst({ filters: { ownerKey, slug }, status: "draft" });

    if (existing) continue;

    try {
      await strapi
        .documents("api::page.page")
        .create({ data: { ownerKey, slug, ...seed }, status: "published" });
    } catch (error) {
      // Same race as the sites, caught by the `uniqueSlugPerOwner` lifecycle on
      // `Page` rather than by a database constraint. Checked, not assumed, for
      // the reason given there.
      const winner = await strapi
        .documents("api::page.page")
        .findFirst({ filters: { ownerKey, slug }, status: "draft" });

      if (!winner) throw error;
      strapi.log.info(`Page ${slug} for ${ownerKey} already created by another instance.`);
    }
  }
}

/**
 * What the profile sites read. A change to any of these can change a public
 * page, so the profile is told to drop its content cache.
 */
const PUBLIC_CONTENT = new Set<string>(PUBLIC_READ);

/**
 * What counts as a change the public can see.
 *
 * Everything except `Site` carries draft-and-publish, so an `update` there is an
 * editor saving a draft — invisible to visitors, and no reason to drop four
 * sites' caches. `Site` has `draftAndPublish: false`, so its `update` *is* the
 * live change, and gating it on `publish` would mean a renamed navigation item
 * never appearing.
 */
const LIVE_ON_UPDATE = new Set<string>(["api::site.site"]);
const PUBLISHED_CHANGE = new Set(["publish", "unpublish", "delete"]);
const DIRECT_CHANGE = new Set(["create", "update", "delete"]);

const changesPublicPages = (uid: string, action: string) =>
  PUBLIC_CONTENT.has(uid) &&
  (LIVE_ON_UPDATE.has(uid) ? DIRECT_CHANGE.has(action) : PUBLISHED_CHANGE.has(action));

/**
 * Tells the profile application that published content changed.
 *
 * Fire-and-forget on purpose: an editor pressing Publish must not see a save
 * fail because a front end was restarting, and the pages are already correct
 * within the cache window without this. It only makes them prompt.
 *
 * Unset environment means this deployment has no profile to notify — a CMS
 * running alone, or a developer who has not filled in `.env`. That is quiet,
 * not a warning, because it is the normal state of a fresh clone.
 */
async function notifyProfile(strapi: Core.Strapi) {
  const url = process.env.PROFILE_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
    if (!response.ok) {
      strapi.log.warn(`Profile revalidation returned ${response.status}.`);
    }
  } catch (error) {
    strapi.log.warn(`Profile revalidation failed: ${String(error)}`);
  }
}

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Registered here rather than configured in the admin panel's webhook
    // screen, for the same reason the public read permissions are: a fresh
    // clone has to work without somebody remembering a manual step, and a
    // forgotten webhook shows up as content that is silently hours stale.
    strapi.documents.use(async (context, next) => {
      const result = await next();

      if (changesPublicPages(context.uid, context.action)) {
        void notifyProfile(strapi);
      }

      return result;
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await grantPublicRead(strapi);
    await seedSites(strapi);
    await seedPages(strapi, "home", HOME_SEED);
    await seedPages(strapi, "pendaftaran", ADMISSION_SEED);
  },
};
