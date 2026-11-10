import type { Core } from "@strapi/strapi";

import {
  backfillApexHomeOnly,
  backfillApexMainMenu,
  backfillArtikel,
  backfillOnce,
  backfillSchoolLinks,
  deleteApexPages,
} from "./backfills";
import { ARTICLES, KOLABORASI_UID, trackCollaborations } from "./collaboration";
import { assertOwnerScope, registerOwnerScope, syncEditorRole } from "./owner-scope";
import { syncPublicRead } from "./public-read";
import { changesPublicPages, notifyProfile } from "./revalidate";
import {
  BERITA_ENTRY_SEED,
  OPINI_ENTRY_SEED,
  PENGUMUMAN_ENTRY_SEED,
  type ArticleSeed,
  type OpiniSeed,
} from "./seed/articles";
import { ARTIKEL_SEED, type ArtikelSeed } from "./seed/artikel-page";
import { EKSTRAKURIKULER_SEED, type EntrySeed } from "./seed/ekstrakurikuler";
import { EKSTRAKURIKULER_PAGE_SEED, type EkstrakurikulerSeed } from "./seed/ekstrakurikuler-page";
import { FASILITAS_SEED } from "./seed/fasilitas";
import { FASILITAS_PAGE_SEED, type FasilitasSeed } from "./seed/fasilitas-page";
import { GALERI_PAGE_SEED, UNDUHAN_PAGE_SEED, type ListingSeed } from "./seed/galeri-page";
import { HOME_SEED, OWNER_KEYS, type HomeSeed, type OwnerKey } from "./seed/home-page";
import { KONTAK_SEED, type KontakSeed } from "./seed/kontak-page";
import { PENCAPAIAN_SEED, type AchievementSeed } from "./seed/pencapaian";
import { ADMISSION_SEED, type AdmissionSeed } from "./seed/pendaftaran-page";
import { PROFIL_SEED, type ProfilSeed } from "./seed/profil-page";
import { PROGRAM_SEED, type ProgramSeed } from "./seed/program-page";
import { OWNER_SEED } from "./seed/site";

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
  slug:
    | "home"
    | "profil"
    | "program"
    | "ekstrakurikuler"
    | "fasilitas"
    | "galeri"
    | "unduhan"
    | "pendaftaran"
    | "kontak"
    | "artikel",
  // Partial, because `/program` is the first route only the schools own: an
  // owner with no seed here has no such page, and the profile app answers 404
  // for it rather than rendering an empty one.
  seeds: Partial<
    Record<
      OwnerKey,
      | HomeSeed
      | ProfilSeed
      | ProgramSeed
      | EkstrakurikulerSeed
      | FasilitasSeed
      | ListingSeed
      | AdmissionSeed
      | KontakSeed
      | ArtikelSeed
    >
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
  uid: "api::berita.berita" | "api::pengumuman.pengumuman" | "api::opini.opini",
  rows: readonly (ArticleSeed | OpiniSeed)[],
) {
  for (const ownerKey of OWNER_KEYS) {
    const owned = rows.filter((row) => row.ownerKey === ownerKey);
    if (owned.length === 0) continue;

    const existing = await strapi.documents(uid).findFirst({ filters: { ownerKey } });
    if (existing) continue;

    for (const seed of owned) {
      // The defaults give every seed both optional fields, so one destructure
      // serves Opini too, which has neither.
      const { daysAgo, expiresInDays, collaborators, ...row } = {
        expiresInDays: undefined,
        collaborators: [],
        ...seed,
      };
      const created = await strapi.documents(uid).create({
        data: {
          ...row,
          // Only when there are some: Opini has no such field to write an empty list to.
          ...(collaborators.length > 0
            ? { collaborators: collaborators.map((key) => ({ ownerKey: key })) }
            : {}),
          ...(expiresInDays === undefined ? {} : { expiresAt: daysFromNow(expiresInDays) }),
        },
        status: "published",
      });

      // Publishing just invited them as `menunggu`; the seed answers for them.
      // Ids first: `updateMany` cannot filter through a relation.
      if (collaborators.length > 0 && uid !== "api::opini.opini") {
        const invites: { id: number }[] = await strapi.db.query(KOLABORASI_UID).findMany({
          where: { [ARTICLES[uid]]: { documentId: created.documentId } },
          select: ["id"],
        });
        await strapi.db.query(KOLABORASI_UID).updateMany({
          where: { id: { $in: invites.map((invite) => invite.id) } },
          data: { status: "diterima" },
        });
      }

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
async function profilSeed(
  strapi: Core.Strapi,
  ownerKey: Exclude<OwnerKey, "mbs">,
): Promise<ProfilSeed> {
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

const BOOT_LOCK = 4820194;

/**
 * Runs bootstrap while holding a Postgres advisory lock, so two instances that
 * boot together take turns instead of both seeing a marker unset or a row
 * missing and both writing it. The seeds and backfills below assume they run
 * alone; this is what makes that true.
 *
 * A session lock belongs to one connection, so it is taken and released on a
 * connection set aside for it. If the release fails, that connection is closed
 * before it goes back to the pool: closing the session frees the lock, where a
 * pooled connection still holding it would stall the next boot. The wait is bounded
 * by `lock_timeout` (`BOOT_LOCK_TIMEOUT`, a Postgres time such as 30s, default 5min),
 * so a hung instance stops the next boot with a reason instead of hanging it.
 */
async function withBootLock(strapi: Core.Strapi, run: () => Promise<void>) {
  const wait = process.env.BOOT_LOCK_TIMEOUT || "5min";
  const knex = strapi.db.connection;
  const connection: unknown = await knex.client.acquireConnection();
  try {
    await knex.raw("select set_config('lock_timeout', ?, false)", [wait]).connection(connection);
    await knex
      .raw("select pg_advisory_lock(?)", [BOOT_LOCK])
      .connection(connection)
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "55P03"
        ) {
          throw new Error(
            `Another CMS instance has held the boot lock (${BOOT_LOCK}) for over ${wait}. Stop it, or find the session holding the lock in pg_locks.`,
          );
        }
        throw error;
      });
    await run();
  } finally {
    // Also undoes `lock_timeout`, so the connection goes back to the pool as it came.
    await knex
      .raw("select pg_advisory_unlock_all(); reset lock_timeout")
      .connection(connection)
      .catch(async (error: unknown) => {
        strapi.log.warn(`Boot lock release failed, closing its connection: ${String(error)}`);
        // A failure here is already logged; it must not hide what `run` threw.
        await knex.client.destroyRawConnection(connection).catch(() => undefined);
      });
    await knex.client.releaseConnection(connection);
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

      const collaborations = await trackCollaborations(strapi, context);
      const result = await next();
      await collaborations(result);

      if (changesPublicPages(context.uid, context.action)) {
        void notifyProfile(strapi);
      }

      return result;
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await withBootLock(strapi, async () => {
      // The condition first: seeding a permission whose condition the provider
      // does not know yet drops the condition and grants the permission outright.
      await registerOwnerScope(strapi);
      await syncEditorRole(strapi);
      await syncPublicRead(strapi);
      await seedSites(strapi);
      // Galeri first: Unduhan anchors on the footer's `/berita` link, which
      // Artikel then replaces. Artikel has to rename the `berita` page before
      // `seedPages` sees no `artikel` row and makes one.
      await backfillOnce(strapi, "galeri-unduhan-links", () => backfillSchoolLinks(strapi));
      await backfillOnce(strapi, "artikel", () => backfillArtikel(strapi));

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
        await seedArticles(strapi, "api::opini.opini", OPINI_ENTRY_SEED);
        await seedAchievements(strapi, PENCAPAIAN_SEED);
      }

      // `relationBlocks` reads what actually exists, so this is the seeded
      // homepage in development and the plain one in production — same call, no
      // second branch.
      await seedPages(strapi, "home", await homeSeeds(strapi));
      await seedPages(strapi, "profil", {
        smp: await profilSeed(strapi, "smp"),
        smk: await profilSeed(strapi, "smk"),
        sma: await profilSeed(strapi, "sma"),
      });
      await seedPages(strapi, "program", PROGRAM_SEED);
      await seedPages(strapi, "ekstrakurikuler", EKSTRAKURIKULER_PAGE_SEED);
      await seedPages(strapi, "fasilitas", FASILITAS_PAGE_SEED);
      await seedPages(strapi, "galeri", GALERI_PAGE_SEED);
      await seedPages(strapi, "unduhan", UNDUHAN_PAGE_SEED);
      await seedPages(strapi, "pendaftaran", ADMISSION_SEED);
      await seedPages(strapi, "kontak", KONTAK_SEED);
      await seedPages(strapi, "artikel", ARTIKEL_SEED);

      // After the seeds, and once per database: the rows above are only created
      // when missing, so a section added to a seed later needs this to reach an
      // environment that has already booted.
      await backfillOnce(strapi, "apex-main-menu", () => backfillApexMainMenu(strapi));
      await backfillOnce(strapi, "apex-home-only", () => backfillApexHomeOnly(strapi));
      await backfillOnce(strapi, "apex-pages-deleted", () => deleteApexPages(strapi));
    });
  },
};
