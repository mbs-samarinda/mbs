import type { Media } from "./cms.ts";

/** One entry in the `/berita` listing, from either of the two types under it. */
export type Article = {
  readonly kind: "Berita" | "Pengumuman";
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly cover: Media | null;
  readonly publishedAt: string;
  /** Pengumuman only, and optional there. A Berita article never expires. */
  readonly expiresAt: string | null;
};

/**
 * What `/berita` does to a list of entries once it has been read.
 *
 * These are pure on purpose. The expiry cut, the month counts and the page
 * window all have to agree with each other — an arsip that says "September 2026
 * (3)" above a month that renders two is the same class of lie as a stale date —
 * and the only way to hold them together is to compute all three from one list,
 * after one cut, against one clock. The clock is an argument rather than
 * `Date.now()` so the agreement is testable.
 */

/** The two collections under `/berita`, as they appear in the URL. */
export const ARTICLE_TYPES = ["berita", "pengumuman"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const isArticleType = (value: string | undefined): value is ArticleType =>
  ARTICLE_TYPES.some((type) => type === value);

/** One archive row: the month, how it is written, and how many entries it holds. */
export type Month = { readonly key: string; readonly label: string; readonly count: number };

const MONTH = new Intl.DateTimeFormat("id-ID", {
  month: "long",
  year: "numeric",
  // Same reason as every other date in this app: an entry published at 17.00
  // UTC on the 31st belongs to the next month in Samarinda.
  timeZone: "Asia/Makassar",
});

/** `2026-09`, in Samarinda time. The value an arsip link carries. */
export function monthKey(iso: string): string {
  // `en-CA` is the one locale that formats as `YYYY-MM-DD`, which makes the key
  // sortable and spares a second date library.
  const [year, month] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Makassar",
  })
    .format(new Date(iso))
    .split("-");

  return `${year}-${month}`;
}

/**
 * Drops what has expired.
 *
 * Only a Pengumuman can expire, and the cut runs against the real clock rather
 * than a cached one: a notice that expires at 10.05 has to be gone at 10.05,
 * not when the cache next refills.
 */
export const cutExpired = (entries: readonly Article[], now: number): Article[] =>
  entries.filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now);

/** Narrows to one collection, or to one month, or both. Newest first throughout. */
export function filterArticles(
  entries: readonly Article[],
  filters: { type?: ArticleType | undefined; month?: string | undefined },
): Article[] {
  const kind =
    filters.type === "berita" ? "Berita" : filters.type === "pengumuman" ? "Pengumuman" : null;

  return entries.filter(
    (entry) =>
      (!kind || entry.kind === kind) &&
      (!filters.month || monthKey(entry.publishedAt) === filters.month),
  );
}

/**
 * The months present in a list, newest first, with exact counts.
 *
 * Counted from the same cut list the page renders, so the number beside a month
 * is the number of entries that link leads to.
 */
export function monthsOf(entries: readonly Article[]): Month[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const entry of entries) {
    const key = monthKey(entry.publishedAt);
    const row = counts.get(key);
    if (row) {
      row.count += 1;
    } else {
      counts.set(key, { label: MONTH.format(new Date(entry.publishedAt)), count: 1 });
    }
  }

  return [...counts]
    .map(([key, row]) => ({ key, ...row }))
    .toSorted((a, b) => b.key.localeCompare(a.key));
}

/** How many entries a listing page holds. One number, so the count and the window agree. */
export const PAGE_SIZE = 12;

/**
 * One page of a listing.
 *
 * `page` is clamped rather than 404'd: `?page=9` on a listing that has shrunk to
 * two pages is a link somebody shared, and the last page is a better answer than
 * a not-found on a page that exists.
 */
export function paginate(entries: readonly Article[], page: number) {
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE_SIZE;

  return {
    entries: entries.slice(start, start + PAGE_SIZE),
    page: current,
    pages,
    total: entries.length,
  };
}

/** `?page=` as an integer, ignoring anything that is not one. */
export const pageParam = (value: string | undefined) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
};
