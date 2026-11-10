import type { Core } from "@strapi/strapi";

import { KOLABORASI_UID } from "./collaboration";
import { notifyProfile } from "./revalidate";
import { HOME_SEED, type HomeSeed } from "./seed/home-page";
import { ARTIKEL_LINKS, OWNER_SEED } from "./seed/site";

/**
 * Runs a repair against rows that already exist, exactly once per database.
 *
 * `seedPages` deliberately never touches a row it finds — that rule is what
 * stops a restart from reverting an editor's work. The cost is that a section
 * added to a seed after first boot reaches only brand-new databases, so a
 * deploy ships the feature invisible. This is the other half: a named repair
 * that runs on the boot after it appears and never again, so a section an
 * editor then deletes stays deleted.
 *
 * The marker lives in Strapi's own key-value store rather than in a field of
 * ours: it is a fact about this database's migration state, not about any
 * page. Clearing the key re-runs the repair, which is the rollback.
 *
 * A backfill only adds or reshapes content. Renaming a field or changing its
 * type goes in `database/migrations` instead: Strapi syncs the schema before
 * bootstrap and drops the old column on the way, so by the time a backfill
 * runs the data it would copy is gone. Migrations run before that sync.
 */
export async function backfillOnce(strapi: Core.Strapi, key: string, run: () => Promise<boolean>) {
  const store = strapi.store({ type: "plugin", name: "mbs-seed" });
  if (await store.get({ key })) return;

  const changed = await run();
  await store.set({ key, value: true });
  strapi.log.info(changed ? `Backfill ${key}: applied.` : `Backfill ${key}: nothing to do.`);
}

/* `__component` is Strapi's discriminator, not a name of ours to rename. */
/* oxlint-disable eslint/no-underscore-dangle */

/** A block the repair is not touching, named so Strapi keeps it as it is. */
const keep = (block: PageBlock) => ({ __component: block.__component, id: block.id });

/** One entry of a page's dynamic zone, as a read returns it. */
type PageBlock = { __component: string; id?: number | string };

/** The sections the apex home dropped when it became the main menu. */
const CAMPAIGN_BLOCKS = new Set([
  "blocks.hero",
  "blocks.admission-table",
  "blocks.facts",
  "blocks.news",
]);

/**
 * Turns an umbrella home seeded as a campaign page into the apex's main menu.
 * The profile app lists every article below the school cards on its own, so
 * the hero, the joint cycle table, the yayasan section and the news section go.
 * Any other block an editor added stays. A database seeded before the cards
 * existed gets the seeded ones.
 *
 * Both copies are checked, since an editor may have cleaned the draft without
 * publishing; the write publishes the cleaned draft.
 *
 * **Kept blocks are passed back by reference**, `__component` and `id` alone. A
 * dynamic zone can only be written whole, and re-sending a block from a shallow
 * read is how an editor's images get dropped on the way out; a reference asks
 * Strapi to keep the component it already has.
 */
export async function backfillApexMainMenu(strapi: Core.Strapi): Promise<boolean> {
  const read = (status: "draft" | "published") =>
    strapi.documents("api::page.page").findFirst({
      filters: { ownerKey: "mbs", slug: "home" },
      status,
      populate: "blocks",
    });
  const [draft, published] = await Promise.all([read("draft"), read("published")]);
  if (!draft?.blocks) return false;

  const stale = [draft, published].some((page) =>
    (page?.blocks ?? []).some((block: PageBlock) => CAMPAIGN_BLOCKS.has(block.__component)),
  );
  const blocks: readonly PageBlock[] = draft.blocks;
  const hasSchools = blocks.some((block) => block.__component === "blocks.schools");
  if (!stale && hasSchools) return false;

  // The generated input type describes a component being *written*, so it wants
  // every field. A reference deliberately carries none — that is the point of it
  // — so this is the one place the shape is asserted rather than proved.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const kept = blocks
    .filter((block) => !CAMPAIGN_BLOCKS.has(block.__component))
    .map(keep) as unknown as HomeSeed["blocks"];
  const next = hasSchools ? kept : [...HOME_SEED.mbs.blocks, ...kept];

  await strapi
    .documents("api::page.page")
    .update({ documentId: draft.documentId, data: { blocks: next }, status: "published" });

  return true;
}

/* oxlint-enable eslint/no-underscore-dangle */

type Link = { label: string; href: string };

/** Puts `link` straight after the link to `after`, or leaves the list alone when that anchor is gone. */
function insertLink(links: readonly Link[], link: Link, after: string): Link[] {
  const at = links.findIndex((entry) => entry.href === after);
  if (at === -1) return [...links];
  return [...links.slice(0, at + 1), link, ...links.slice(at + 1)];
}

/**
 * Links as label and href alone, the shape a write takes. Read types call every
 * field optional, required ones included; both are required on `shared.link`,
 * so the filter drops nothing real.
 */
const plain = (links: readonly { label?: string | null; href?: string | null }[] | null = []) =>
  (links ?? []).flatMap(({ label, href }) => (label && href ? [{ label, href }] : []));

/** Where each new page goes, by the link it follows in `schoolSite`. */
const SCHOOL_LINKS = [
  { link: { label: "Galeri", href: "/galeri" }, after: "/fasilitas" },
  { link: { label: "Unduhan", href: "/unduhan" }, after: "/berita" },
] as const;

/**
 * Galeri and Unduhan in the footer of a school site seeded before either page
 * existed. `seedSites` never touches a row it finds, so without this a deploy ships both
 * pages with nothing linking to them.
 *
 * Each link lands after the one it follows in `schoolSite`. A link already
 * present is left where it is, and a missing anchor skips that column, because
 * an editor who removed it has rearranged the footer and a guess would undo
 * their work.
 *
 * Links are written back as label and href alone: they carry nothing else, and
 * `Site` has no draft, so this is live the moment it runs.
 */
export async function backfillSchoolLinks(strapi: Core.Strapi): Promise<boolean> {
  const sites = await strapi.documents("api::site.site").findMany({
    filters: { ownerKey: { $in: ["smp", "smk", "sma"] } },
    populate: { footerColumns: { populate: ["links"] } },
  });

  let changed = false;
  for (const site of sites) {
    let columns = (site.footerColumns ?? []).map((column) => ({
      heading: column.heading ?? "",
      links: plain(column.links),
    }));
    const before = JSON.stringify(columns);

    for (const { link, after } of SCHOOL_LINKS) {
      if (!columns.some((column) => column.links.some((entry) => entry.href === link.href))) {
        columns = columns.map((column) => ({
          ...column,
          links: insertLink(column.links, link, after),
        }));
      }
    }

    if (JSON.stringify(columns) === before) continue;
    await strapi.documents("api::site.site").update({
      documentId: site.documentId,
      data: { footerColumns: columns },
    });
    changed = true;
  }

  return changed;
}

/** A path on the apex other than its home. Absolute links and anchors are not paths. */
const isApexDead = (href: string) => href.startsWith("/") && href !== "/";

/**
 * Strips the umbrella's links to pages the apex no longer has, on a database
 * seeded while it still had them. The apex now serves only its home, so every
 * other path in its menu and footer leads to the 404. Absolute links and
 * anchors an editor added stay; a footer column left with no links goes.
 */
export async function backfillApexHomeOnly(strapi: Core.Strapi): Promise<boolean> {
  let changed = false;
  const site = await strapi.documents("api::site.site").findFirst({
    filters: { ownerKey: "mbs" },
    populate: { menu: { populate: ["links"] }, footerColumns: { populate: ["links"] } },
  });

  const allLinks = [
    ...(site?.menu ?? []).flatMap((item) => [{ href: item.href ?? "" }, ...plain(item.links)]),
    ...(site?.footerColumns ?? []).flatMap((column) => plain(column.links)),
  ];
  if (site && allLinks.some((link) => isApexDead(link.href))) {
    const menu = (site.menu ?? [])
      .map((item) => ({
        label: item.label ?? "",
        href: item.href && !isApexDead(item.href) ? item.href : undefined,
        links: plain(item.links).filter((link) => !isApexDead(link.href)),
      }))
      // An item with neither a live address nor a live dropdown link goes.
      .filter((item) => item.href || item.links.length > 0);
    const footerColumns = (site.footerColumns ?? [])
      .map((column) => ({
        heading: column.heading ?? "",
        links: plain(column.links).filter((link) => !isApexDead(link.href)),
      }))
      .filter((column) => column.links.length > 0);

    await strapi
      .documents("api::site.site")
      .update({ documentId: site.documentId, data: { menu, footerColumns } });
    changed = true;
  }

  return changed;
}

/**
 * Deletes the umbrella's page rows for the routes the apex no longer has. Nothing
 * renders them, and an editor finding them in the CMS would edit a page no one
 * can open. The umbrella's articles are not pages and stay: the apex home lists
 * them and each keeps its own page there.
 */
export async function deleteApexPages(strapi: Core.Strapi): Promise<boolean> {
  const pages = await strapi.documents("api::page.page").findMany({
    filters: { ownerKey: "mbs", slug: { $in: ["profil", "pendaftaran", "kontak", "artikel"] } },
    fields: ["documentId"],
  });

  for (const page of pages) {
    await strapi.documents("api::page.page").delete({ documentId: page.documentId });
  }
  return pages.length > 0;
}

/**
 * Moves a database seeded before Opini onto the Artikel addresses.
 *
 * - A site with an empty `menu` gets its seeded one. `menu` replaced the flat
 *   `navigation`, whose contents could only be copied while it existed; past
 *   that, a database from before the switch has no menu at all, and an empty
 *   header is worse than a default an editor then adjusts.
 * - A footer `/berita` link becomes the four Artikel links, where it stood.
 * - The `berita` page row becomes `artikel`, keeping the editor's title and SEO.
 * - Each Kolaborasi copy of an address gains its type: `…/berita/x` becomes
 *   `…/artikel/berita/x` or `…/artikel/pengumuman/x`.
 * - The homepage news section's head, field by field, only where it still
 *   holds the seeded value: its link now leads to `/artikel`, and its title
 *   and link text name all three types. A value an editor typed stays.
 *
 * Runs before `seedPages`, which would otherwise create a fresh `artikel` row
 * beside the `berita` one this renames.
 */
export async function backfillArtikel(strapi: Core.Strapi): Promise<boolean> {
  let changed = false;

  const sites = await strapi.documents("api::site.site").findMany({
    populate: { menu: true, footerColumns: { populate: ["links"] } },
  });

  for (const site of sites) {
    const seeded = OWNER_SEED.find((seed) => seed.ownerKey === site.ownerKey)?.menu;
    const menuMissing = (site.menu ?? []).length === 0 && seeded !== undefined;
    const columns = (site.footerColumns ?? []).map((column) => ({
      heading: column.heading ?? "",
      links: plain(column.links).flatMap((link) =>
        link.href === "/berita" ? ARTIKEL_LINKS : [link],
      ),
    }));
    const footerChanged = (site.footerColumns ?? []).some((column) =>
      plain(column.links).some((link) => link.href === "/berita"),
    );

    if (!menuMissing && !footerChanged) continue;
    await strapi.documents("api::site.site").update({
      documentId: site.documentId,
      data: {
        ...(menuMissing ? { menu: seeded } : {}),
        ...(footerChanged ? { footerColumns: columns } : {}),
      },
    });
    changed = true;
  }

  // Both rows of each document, draft and published, in one write.
  const pages = await strapi.db
    .query("api::page.page")
    .updateMany({ where: { slug: "berita" }, data: { slug: "artikel" } });
  if (pages.count > 0) changed = true;

  // Draft and published rows each own a copy of the component, so both move.
  for (const [field, from, to] of [
    ["linkHref", "/berita", "/artikel"],
    ["linkLabel", "Lihat semua berita", "Lihat semua artikel"],
    ["heading", "Berita & Pengumuman", "Artikel"],
  ] as const) {
    const heads = await strapi.db
      .query("shared.section-head")
      .updateMany({ where: { [field]: from }, data: { [field]: to } });
    if (heads.count > 0) changed = true;
  }

  // Old addresses only: a migrated `/artikel/berita/x` contains `/berita/` too,
  // and rewriting it again would give `/artikel/artikel/berita/x`.
  type Invite = {
    id: number;
    alamat: string;
    berita: { id: number } | null;
    pengumuman: { id: number } | null;
  };
  const invites: Invite[] = await strapi.db.query(KOLABORASI_UID).findMany({
    where: { alamat: { $contains: "/berita/", $notContains: "/artikel/" } },
    select: ["id", "alamat"],
    populate: { berita: { select: ["id"] }, pengumuman: { select: ["id"] } },
  });
  for (const invite of invites) {
    // A row whose article is gone names no type; the next publish rewrites it anyway.
    const type = invite.berita ? "berita" : invite.pengumuman ? "pengumuman" : null;
    if (!type) continue;
    await strapi.db.query(KOLABORASI_UID).update({
      where: { id: invite.id },
      data: { alamat: invite.alamat.replace("/berita/", `/artikel/${type}/`) },
    });
    changed = true;
  }

  // These writes skip the document middleware, so the profile is told directly.
  if (changed) void notifyProfile(strapi);
  return changed;
}
