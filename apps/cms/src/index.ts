import type { Core } from "@strapi/strapi";

import { assertOwnerScope, registerOwnerScope, seedEditorRole } from "./owner-scope";
import { BERITA_ENTRY_SEED, PENGUMUMAN_ENTRY_SEED, type ArticleSeed } from "./seed/articles";
import { BERITA_SEED, type BeritaSeed } from "./seed/berita-page";
import { EKSTRAKURIKULER_SEED, type EntrySeed } from "./seed/ekstrakurikuler";
import { FASILITAS_SEED } from "./seed/fasilitas";
import { HOME_SEED, OWNER_KEYS, type HomeSeed, type OwnerKey } from "./seed/home-page";
import { KONTAK_SEED, type KontakSeed } from "./seed/kontak-page";
import { PENCAPAIAN_SEED, type AchievementSeed } from "./seed/pencapaian";
import { ADMISSION_SEED, type AdmissionSeed } from "./seed/pendaftaran-page";
import { PROFIL_SEED, type ProfilSeed } from "./seed/profil-page";
import { PROGRAM_SEED, type ProgramSeed } from "./seed/program-page";

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

// Official accounts, shown on `/kontak` only. Placeholders like every other
// handle here: no school has confirmed which accounts are theirs.
const SOCIALS = [
  { label: "Instagram", href: "https://instagram.com/" },
  { label: "YouTube", href: "https://youtube.com/" },
  { label: "Facebook", href: "https://facebook.com/" },
];

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
    hours: "Senin–Jumat 07.00–15.00 WITA",
    mapsCoordinates: "-0.4669401,117.1951261",
    socials: SOCIALS,
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
  slug: "home" | "profil" | "program" | "pendaftaran" | "kontak" | "berita",
  // Partial, because `/program` is the first route only the schools own: an
  // owner with no seed here has no such page, and the profile app answers 404
  // for it rather than rendering an empty one.
  seeds: Partial<
    Record<OwnerKey, HomeSeed | ProfilSeed | ProgramSeed | AdmissionSeed | KontakSeed | BeritaSeed>
  >,
) {
  for (const ownerKey of OWNER_KEYS) {
    const seed = seeds[ownerKey];
    if (!seed) continue;

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
 * Gives an owner its starting records in one collection, or leaves it alone.
 *
 * The check is per owner rather than per row: a school that has published its
 * own facilities and then deleted one must not have it restored on the next
 * restart. Same rule as the sites and the pages — create what is missing, never
 * touch what is there — applied at the level where "missing" means anything.
 */
async function seedEntries(
  strapi: Core.Strapi,
  uid: "api::ekstrakurikuler.ekstrakurikuler" | "api::fasilitas.fasilitas",
  rows: readonly EntrySeed[],
) {
  for (const ownerKey of OWNER_KEYS) {
    const owned = rows.filter((row) => row.ownerKey === ownerKey);
    if (owned.length === 0) continue;

    const existing = await strapi.documents(uid).findFirst({ filters: { ownerKey } });
    if (existing) continue;

    for (const row of owned) {
      await strapi.documents(uid).create({ data: row, status: "published" });
    }
  }
}

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/**
 * The news and notices, dated relative to this boot.
 *
 * `publishedAt` is written explicitly rather than left to the create call: the
 * listing sorts on it, so seeding them all at one timestamp would put them in an
 * arbitrary order. Relative dates also keep a fresh deployment from opening with
 * a page of news from whenever this file was written.
 */
async function seedArticles(
  strapi: Core.Strapi,
  uid: "api::berita.berita" | "api::pengumuman.pengumuman",
  rows: readonly ArticleSeed[],
) {
  for (const ownerKey of OWNER_KEYS) {
    const owned = rows.filter((row) => row.ownerKey === ownerKey);
    if (owned.length === 0) continue;

    const existing = await strapi.documents(uid).findFirst({ filters: { ownerKey } });
    if (existing) continue;

    for (const { daysAgo, expiresInDays, ...row } of owned) {
      const created = await strapi.documents(uid).create({
        data: {
          ...row,
          ...(expiresInDays === undefined ? {} : { expiresAt: daysFromNow(expiresInDays) }),
        },
        status: "published",
      });

      // `publishedAt` cannot be set through the Document Service: publishing
      // stamps it with the current time and drops whatever was passed in, which
      // is right for an editor pressing Publish and wrong for a seed that has to
      // land in a particular order. The published row is written directly, and
      // only that row — the draft beside it keeps a null `publishedAt`, which is
      // what makes it a draft.
      await strapi.db.query(uid).updateMany({
        where: { documentId: created.documentId, publishedAt: { $notNull: true } },
        data: { publishedAt: daysFromNow(-daysAgo) },
      });
    }
  }
}

/** The achievements, each linked to the article that tells its story when there is one. */
async function seedAchievements(strapi: Core.Strapi, rows: readonly AchievementSeed[]) {
  const year = new Date().getFullYear();

  for (const ownerKey of OWNER_KEYS) {
    const owned = rows.filter((row) => row.ownerKey === ownerKey);
    if (owned.length === 0) continue;

    const existing = await strapi
      .documents("api::pencapaian.pencapaian")
      .findFirst({ filters: { ownerKey } });
    if (existing) continue;

    for (const { yearsAgo, beritaSlug, ...row } of owned) {
      // The article is seeded first, so this finds it — but an editor may have
      // deleted it, and an achievement is worth having without its story.
      const berita = beritaSlug
        ? await strapi
            .documents("api::berita.berita")
            .findFirst({ filters: { ownerKey, slug: beritaSlug } })
        : null;

      await strapi.documents("api::pencapaian.pencapaian").create({
        data: {
          ...row,
          year: year - yearsAgo,
          ...(berita ? { berita: berita.documentId } : {}),
        },
        status: "published",
      });
    }
  }
}

/** A relation is stored by document id, so that is what a block's `items` holds. */
const ids = (rows: readonly { documentId: string }[]) => rows.map((row) => row.documentId);

/**
 * The homepage's three relation sections, built from what the owner actually has.
 *
 * They cannot live in `HOME_SEED` beside the other blocks: a relation is stored
 * by document id, and those ids only exist once the records above have been
 * created. A section whose records are missing is left out rather than seeded
 * empty, which is what the umbrella gets — it runs no classes and owns no
 * buildings.
 */
async function relationBlocks(
  strapi: Core.Strapi,
  ownerKey: OwnerKey,
): Promise<HomeSeed["blocks"]> {
  // Sorted, because the sections below take the first few: unsorted, which of
  // SMK's seven facilities gets left out is whatever order the database happens
  // to return.
  const sort = "createdAt:asc";
  const [ekstrakurikuler, fasilitas, pencapaian] = await Promise.all([
    strapi
      .documents("api::ekstrakurikuler.ekstrakurikuler")
      .findMany({ filters: { ownerKey }, sort }),
    strapi.documents("api::fasilitas.fasilitas").findMany({ filters: { ownerKey }, sort }),
    strapi.documents("api::pencapaian.pencapaian").findMany({ filters: { ownerKey }, sort }),
  ]);

  const blocks: HomeSeed["blocks"] = [];

  if (ekstrakurikuler.length > 0) {
    blocks.push({
      __component: "blocks.extracurriculars",
      head: {
        heading: "Ekstrakurikuler",
        description: "Kegiatan di luar jam pelajaran, dibina pengajar dan pembina asrama.",
        linkLabel: "Lihat semua ekstrakurikuler",
        linkHref: "/ekstrakurikuler",
      },
      items: ids(ekstrakurikuler).slice(0, 6),
    });
  }

  if (fasilitas.length > 0) {
    blocks.push({
      __component: "blocks.facilities",
      head: {
        heading: "Fasilitas",
        description: "Ruang belajar, asrama, dan tempat praktik yang dipakai setiap hari.",
        linkLabel: "Lihat semua fasilitas",
        linkHref: "/fasilitas",
      },
      items: ids(fasilitas).slice(0, 6),
    });
  }

  if (pencapaian.length > 0) {
    blocks.push({
      __component: "blocks.achievements",
      // No link: `/pencapaian` is not a route on any owner's site. The section
      // is the whole list.
      head: {
        heading: "Pencapaian",
        description: "Catatan prestasi santri, per tingkat dan tahun.",
      },
      items: ids(pencapaian),
    });
  }

  return blocks;
}

/**
 * `HOME_SEED`, with each owner's relation sections inserted before its news
 * section — the order the page map gives, and the order the canvas draws.
 */
async function homeSeed(strapi: Core.Strapi, ownerKey: OwnerKey): Promise<HomeSeed> {
  const seed = HOME_SEED[ownerKey];
  const extra = await relationBlocks(strapi, ownerKey);
  // `__component` is Strapi's discriminator, not a name of ours to rename.
  // oxlint-disable-next-line eslint/no-underscore-dangle
  const newsAt = seed.blocks.findIndex((block) => block.__component === "blocks.news");
  const at = newsAt === -1 ? seed.blocks.length : newsAt;

  return { ...seed, blocks: [...seed.blocks.slice(0, at), ...extra, ...seed.blocks.slice(at)] };
}

/**
 * `PROFIL_SEED`, with the owner's pencapaian section appended.
 *
 * Same reason the homepage's relation sections are built here: an achievement is
 * referenced by document id, and those exist only once the records do. The
 * section closes the page, which is where the canvas draws it.
 */
async function profilSeed(strapi: Core.Strapi, ownerKey: OwnerKey): Promise<ProfilSeed> {
  const seed = PROFIL_SEED[ownerKey];
  const pencapaian = await strapi
    .documents("api::pencapaian.pencapaian")
    .findMany({ filters: { ownerKey }, sort: "createdAt:asc" });

  if (pencapaian.length === 0) return seed;

  return {
    ...seed,
    blocks: [
      ...seed.blocks,
      {
        __component: "blocks.achievements",
        head: {
          heading: "Pencapaian",
          description:
            "Catatan per tingkat dan tahun. Sebagian menautkan ke satu berita yang menceritakannya.",
        },
        items: ids(pencapaian),
      },
    ],
  };
}

// Written out per owner rather than accumulated in a loop: building a
// `Record<OwnerKey, …>` by assignment starts from an empty object, and the only
// way to call that a complete record is to assert it.
async function homeSeeds(strapi: Core.Strapi): Promise<Record<OwnerKey, HomeSeed>> {
  return {
    mbs: await homeSeed(strapi, "mbs"),
    smp: await homeSeed(strapi, "smp"),
    smk: await homeSeed(strapi, "smk"),
    sma: await homeSeed(strapi, "sma"),
  };
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
      // Before the write, not after: a condition cannot see a row that does not
      // exist yet, so create is guarded here or nowhere.
      await assertOwnerScope(strapi, context);

      const result = await next();

      if (changesPublicPages(context.uid, context.action)) {
        void notifyProfile(strapi);
      }

      return result;
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // The condition first: seeding a permission whose condition the provider
    // does not know yet drops the condition and grants the permission outright.
    await registerOwnerScope(strapi);
    await seedEditorRole(strapi);
    await grantPublicRead(strapi);
    await seedSites(strapi);

    // Sample content is a development fixture and never reaches a real server.
    //
    // The structure above and below this block is different: a `Site` row is an
    // identity every page reads — without one the profile app throws — and a
    // `Page` row is the surface an editor composes on, one per route rather than
    // something they create. Neither states a fact about a school.
    //
    // These records do. An article carries a date, an achievement carries a
    // recipient, and a facility says a building exists. Publishing an invented
    // one on a school's own website is a lie with a date on it, however plainly
    // it was meant as a placeholder — and a half-finished deployment is exactly
    // where nobody is looking. So a production CMS starts with real emptiness,
    // which every page already handles, and an editor fills it.
    if (process.env.NODE_ENV !== "production") {
      // Records first: the homepage's sections point at them by document id, and
      // the achievements point at the articles.
      await seedEntries(strapi, "api::ekstrakurikuler.ekstrakurikuler", EKSTRAKURIKULER_SEED);
      await seedEntries(strapi, "api::fasilitas.fasilitas", FASILITAS_SEED);
      await seedArticles(strapi, "api::berita.berita", BERITA_ENTRY_SEED);
      await seedArticles(strapi, "api::pengumuman.pengumuman", PENGUMUMAN_ENTRY_SEED);
      await seedAchievements(strapi, PENCAPAIAN_SEED);
    }

    // `relationBlocks` reads what actually exists, so this is the seeded
    // homepage in development and the plain one in production — same call, no
    // second branch.
    await seedPages(strapi, "home", await homeSeeds(strapi));
    await seedPages(strapi, "profil", {
      mbs: await profilSeed(strapi, "mbs"),
      smp: await profilSeed(strapi, "smp"),
      smk: await profilSeed(strapi, "smk"),
      sma: await profilSeed(strapi, "sma"),
    });
    await seedPages(strapi, "program", PROGRAM_SEED);
    await seedPages(strapi, "pendaftaran", ADMISSION_SEED);
    await seedPages(strapi, "kontak", KONTAK_SEED);
    await seedPages(strapi, "berita", BERITA_SEED);
  },
};
