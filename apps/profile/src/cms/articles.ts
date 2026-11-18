import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { z } from "zod";

import { cutExpired, type Article, type ArticleType } from "@/articles.ts";
import type { Owner } from "@/owners.ts";

import { cms, cmsData, CMS_TAG, list, type Media, PAGE_LIMIT, parseRows, Row } from "./client.ts";
import type { Page } from "./pages.ts";

export type Achievement = {
  readonly slug: string;
  readonly title: string;
  readonly level: "sekolah" | "kabupaten" | "provinsi" | "nasional" | "internasional";
  readonly year: number;
  readonly recipient: string;
  readonly photo: Media | null;
  readonly berita: { readonly slug: string } | null;
};

/** An index row as Strapi returns it, before the collaborators are flattened. */
type IndexRow = Omit<Article, "type" | "collaborators" | "byline"> & {
  readonly kolaborasi: readonly { readonly ownerKey: SchoolKey }[];
};

/** Opini's two author fields, as both its index rows and its full rows carry them. */
type Author = { readonly authorName?: string | null; readonly authorRole?: string | null };

/** "Siti Aminah, Guru Fisika", or `null` for the types that carry no author. */
const bylineOf = ({ authorName, authorRole }: Author) =>
  authorName && authorRole ? `${authorName}, ${authorRole}` : null;

const CollabRow = z.looseObject({ kolaborasi: list(Row) });

// Fixed order rather than acceptance order, so a card's badges read the same
// on every site.
const withCollaborators = ({ kolaborasi, ...entry }: IndexRow) => ({
  ...entry,
  collaborators: SCHOOLS.map((school) => school.key).filter((key) =>
    kolaborasi.some((row) => row.ownerKey === key),
  ),
});

/**
 * Every entry an owner lists, all three types, newest first, with the expiry not
 * yet applied.
 *
 * A school lists what it owns plus what it accepted as a collaborator; the
 * umbrella lists everything, no invite needed. Accepted collaborators come
 * along for the badges. A pending invite is filtered out in both places, so an
 * article a school has not agreed to never carries its name. Opini is never a
 * collab, so it is read by owner alone and without the relation it does not have.
 *
 * One read serves the whole `/artikel` page — the listing, the archive counts and
 * the page total — because those three have to agree with each other. Counting
 * from a separate query would let the arsip say "September 2026 (3)" above a
 * month that renders two.
 *
 * The expiry cut deliberately does not happen here. A cutoff computed inside a
 * cached function is frozen into the entry: it is not part of the cache key, so
 * it does not bust anything, and a notice that expires at 10:05 would sit on the
 * page until the entry refilled near 11:00. Cache the list, cut it outside.
 *
 * ponytail: the whole list is fetched and held in memory, 100 rows per request
 * (Strapi's `maxLimit`). At the scale these sites run — the previous SMK site
 * had one article — that is one request an hour per owner. Past roughly a
 * thousand entries, move the paging and the month counts into Strapi and pay for
 * the second query.
 */
async function fetchArticleIndex(ownerKey: Owner["key"]): Promise<Article[]> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `articles:${ownerKey}`);

  const scope: [string, string][] =
    ownerKey === "mbs"
      ? []
      : [
          ["filters[$or][0][ownerKey][$eq]", ownerKey],
          ["filters[$or][1][kolaborasi][ownerKey][$eq]", ownerKey],
          ["filters[$or][1][kolaborasi][keputusan][$eq]", "diterima"],
        ];

  // Asking Opini for `kolaborasi` would be a 400: Strapi refuses an unknown relation.
  const collab: [string, string][] = [
    ...scope,
    ["populate[kolaborasi][filters][keputusan][$eq]", "diterima"],
    ["populate[kolaborasi][fields][0]", "ownerKey"],
  ];
  const own: [string, string][] = ownerKey === "mbs" ? [] : [["filters[ownerKey][$eq]", ownerKey]];

  /**
   * Walks Strapi's pages until one comes back short or empty. Short is judged
   * on what Strapi sent, not on the rows that passed `row`: a dropped row would
   * make a full page look like the last one.
   */
  async function all<T>(
    collection: string,
    fields: [string, string][],
    row: z.ZodType,
  ): Promise<T[]> {
    const rows: unknown[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      // Sequential on purpose: the last page is only known when it arrives.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const batch = await cmsData(collection, [
        ...fields,
        ["sort[0]", "publishedAt:desc"],
        ["pagination[page]", String(page)],
        ["pagination[pageSize]", String(PAGE_LIMIT)],
        ["populate[cover]", "true"],
      ]);
      rows.push(...batch);
      if (batch.length < PAGE_LIMIT) return parseRows<T>(row, rows);
    }

    // A Strapi that ignores `pagination[page]` answers every page in full.
    throw new Error(`CMS sent ${MAX_PAGES} full pages of ${collection} without an end`);
  }

  const [berita, pengumuman, opini] = await Promise.all([
    all<Omit<IndexRow, "expiresAt">>("berita-list", collab, CollabRow),
    all<IndexRow>("pengumuman-list", collab, CollabRow),
    all<Omit<IndexRow, "expiresAt" | "kolaborasi"> & Author>("opini-list", own, Row),
  ]);

  return [
    // Only a Pengumuman can expire; Berita and Opini are permanent by type.
    ...berita.map((entry) => ({
      ...withCollaborators({ ...entry, expiresAt: null }),
      type: "berita" as const,
      byline: null,
    })),
    ...pengumuman.map((entry) => ({
      ...withCollaborators(entry),
      type: "pengumuman" as const,
      byline: null,
    })),
    ...opini.map((row) => ({
      ...row,
      expiresAt: null,
      collaborators: [],
      type: "opini" as const,
      byline: bylineOf(row),
    })),
  ].toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** 5,000 entries per collection, far past what one school publishes. */
const MAX_PAGES = 50;

/**
 * Every unexpired entry, newest first, cut against the real clock.
 *
 * Strictly by date, with no pinning: pinning is how the old SMK homepage ended
 * up telling parents a 2026/2027 intake was open on a page last touched in
 * October 2025. An expired Pengumuman drops out for the same reason.
 *
 * `connection()` says out loud what this does: it reads the clock, so it must
 * never be prerendered. The deploy's `next build --experimental-build-mode
 * compile` builds fine without the call, so this line, not the build, is what
 * keeps a prerender from freezing the cutoff into a static shell. Cutting inside the cached function instead would
 * freeze it for an hour. Callers put it behind `<Suspense>`,
 * so only the listing waits; the entries are still served from the cache above.
 */
export async function getArticleIndex(ownerKey: Owner["key"]): Promise<Article[]> {
  const entries = await fetchArticleIndex(ownerKey);
  await connection();
  return cutExpired(entries, Date.now());
}

/**
 * The newest entries for the homepage's latest-entries section.
 *
 * A listing can come back short of `limit` when several of the newest entries
 * have expired, which is correct: the alternative is over-fetching to fill a row
 * that nobody promised would be full.
 */
export async function getArticles(ownerKey: Owner["key"], limit: number): Promise<Article[]> {
  return (await getArticleIndex(ownerKey)).slice(0, limit);
}

/** One article, with the parts only its own page renders. */
// No collaborators: the article's own page shows none, so it does not read them.
export type FullArticle = Omit<Article, "collaborators"> & {
  readonly body: string;
  readonly attribution: string | null;
  readonly seo: Page["seo"];
};

/**
 * One entry by address. The type is part of the address, so only that one
 * collection is asked, and a slug may repeat across types.
 *
 * No expiry cut here, deliberately. `expiresAt` means "drops out of listings" —
 * the schema says so — and a notice somebody bookmarked or was sent by WhatsApp
 * should still open rather than 404. It carries its own publication date, which
 * is what dates it.
 */
export async function getArticle(
  ownerKey: Owner["key"],
  type: ArticleType,
  slug: string,
): Promise<FullArticle | null> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `article:${ownerKey}:${type}:${slug}`);

  const fields: [string, string][] = [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[slug][$eq]", slug],
    ["populate[cover]", "true"],
    ["populate[seo][populate]", "*"],
  ];

  // Each type omits a field or two the others have; Strapi just leaves them out.
  type ArticleRow = Omit<FullArticle, "type" | "byline" | "expiresAt" | "attribution"> &
    Author & { readonly expiresAt?: string | null; readonly attribution?: string | null };
  const [row] = await cms<ArticleRow>(`${type}-list`, fields);
  if (!row) return null;

  return {
    ...row,
    type,
    expiresAt: row.expiresAt ?? null,
    attribution: row.attribution ?? null,
    byline: bylineOf(row),
  };
}

/**
 * The achievement an article tells the story of, if there is one.
 *
 * Read backwards through `Pencapaian.berita` rather than added as a field on
 * Berita: the relation already exists in that direction, and a second one would
 * be a schema change for something a filter does. A Pengumuman can never have
 * one, which is why the panel is absent from the umbrella's article frames.
 */
export async function getRelatedAchievement(
  ownerKey: Owner["key"],
  slug: string,
): Promise<Achievement | null> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `achievement-for:${ownerKey}:${slug}`);

  const found = await cms<Achievement>("pencapaian-list", [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[berita][slug][$eq]", slug],
    ["populate[berita]", "true"],
  ]);

  return found[0] ?? null;
}
