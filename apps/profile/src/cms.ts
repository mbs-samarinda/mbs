import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

import { config } from "./config/env.ts";
import type { Owner } from "./owners.ts";

/**
 * Everything the profile sites read out of Strapi.
 *
 * Reads are cached rather than fetched per request: this is published content,
 * and the pages are meant to be static. Live admission facts are the opposite
 * case and live in `admission.ts`, uncached, behind a `<Suspense>` boundary.
 *
 * The shapes below are hand-written from the schemas in `apps/cms`. Nothing
 * validates them at runtime, deliberately: this is our own CMS behind our own
 * schema, not a third party, and a per-field schema here would be the content
 * model written a second time in a second language, drifting from the first.
 */

export type Media = {
  readonly url: string;
  readonly alternativeText: string | null;
  readonly width: number;
  readonly height: number;
};

export type CmsLink = { readonly label: string; readonly href: string };

export type Site = {
  readonly ownerKey: Owner["key"];
  readonly tagline: string;
  readonly brandSubline: string | null;
  readonly logo: Media | null;
  readonly address: string | null;
  readonly hours: string | null;
  readonly legal: string | null;
  readonly copyright: string | null;
  readonly admissionCta: string;
  readonly navigation: readonly CmsLink[];
  readonly headerPhone: CmsLink | null;
  readonly headerWhatsapp: CmsLink | null;
  readonly footerColumns: readonly {
    readonly heading: string;
    readonly links: readonly CmsLink[];
  }[];
  readonly contacts: readonly {
    readonly label: string;
    readonly value: string;
    readonly href: string;
  }[];
};

type SectionHead = {
  readonly heading: string;
  readonly description: string | null;
  readonly linkLabel: string | null;
  readonly linkHref: string | null;
};

/** A record with its own page: a facility, an activity. */
export type Entry = {
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly images: readonly Media[];
};

export type Achievement = {
  readonly slug: string;
  readonly title: string;
  readonly level: "sekolah" | "kabupaten" | "provinsi" | "nasional" | "internasional";
  readonly year: number;
  readonly recipient: string;
  readonly photo: Media | null;
  readonly berita: { readonly slug: string } | null;
};

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
 * One composed section. Strapi names the discriminator `__component` and
 * prefixes every value with `blocks.`; `toBlock` below renames it on the way in
 * so the pages switch on a plain `kind`.
 */
export type Block = { readonly id: number } & (
  | { readonly kind: "hero"; heading: string; body: string | null; image: Media | null }
  | {
      readonly kind: "image-text";
      heading: string | null;
      body: string;
      image: Media | null;
      imageSide: "awal" | "akhir";
    }
  | {
      readonly kind: "programs";
      head: SectionHead;
      items: readonly { title: string; description: string | null; points: string | null }[];
    }
  | { readonly kind: "facilities"; head: SectionHead; items: readonly Entry[] }
  | { readonly kind: "extracurriculars"; head: SectionHead; items: readonly Entry[] }
  | { readonly kind: "achievements"; head: SectionHead; items: readonly Achievement[] }
  | { readonly kind: "news"; head: SectionHead; limit: number }
  | { readonly kind: "admission-cta"; heading: string; body: string | null }
);

export type Page = {
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly seo: {
    readonly metaTitle: string | null;
    readonly metaDescription: string | null;
    readonly shareImage: Media | null;
  } | null;
};

/**
 * The tag every content read carries, and the one the CMS invalidates when an
 * editor publishes. The per-owner tags below sit alongside it and are finer
 * than anything invalidates today; they cost one string each and are what a
 * per-owner webhook would use.
 */
export const CMS_TAG = "cms";

/** Strapi returns media paths relative to its own host when storage is local. */
export const mediaUrl = (media: Media) =>
  media.url.startsWith("http") ? media.url : `${config.cmsUrl}${media.url}`;

async function cms<T>(collection: string, params: [string, string][]) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${config.cmsUrl}/api/${collection}?${query}`);

  if (!response.ok) {
    throw new Error(`CMS returned ${response.status} for ${collection}`);
  }

  const body: { data: T } = await response.json();
  return body.data;
}

/**
 * Strapi 5 populates a dynamic zone per component, so every block that holds a
 * relation, a nested component or an image has to name what it needs. A block
 * left out of this list does not arrive at all — the `on` fragment drops it from
 * the response rather than returning it bare. Add a block here when you render
 * it, or the page renders nothing where the editor placed it.
 */
const BLOCK_POPULATE: [string, string][] = [
  ["populate[blocks][on][blocks.hero][populate]", "*"],
  ["populate[blocks][on][blocks.image-text][populate]", "*"],
  ["populate[blocks][on][blocks.programs][populate]", "*"],
  ["populate[blocks][on][blocks.news][populate]", "*"],
  ["populate[blocks][on][blocks.admission-cta][populate]", "*"],
  ["populate[blocks][on][blocks.facilities][populate][head]", "true"],
  ["populate[blocks][on][blocks.facilities][populate][items][populate]", "images"],
  ["populate[blocks][on][blocks.extracurriculars][populate][head]", "true"],
  ["populate[blocks][on][blocks.extracurriculars][populate][items][populate]", "images"],
  ["populate[blocks][on][blocks.achievements][populate][head]", "true"],
  // Two keys rather than one comma-separated value: Strapi rejects the comma
  // form inside a dynamic-zone fragment with a 400.
  ["populate[blocks][on][blocks.achievements][populate][items][populate][0]", "photo"],
  ["populate[blocks][on][blocks.achievements][populate][items][populate][1]", "berita"],
  ["populate[seo][populate]", "*"],
];

/**
 * Renames Strapi's discriminator. This is the one place the wire shape is
 * asserted into the union above: everything downstream switches on `kind` and
 * never sees a `blocks.` prefix.
 */
function toBlock(raw: Record<string, unknown>): Block {
  const { ["__component"]: component, ...rest } = raw;
  // The one assertion in this module, and the only place the wire shape is
  // narrowed: what arrives is JSON, and its shape is guaranteed by the CMS
  // schema rather than by anything the compiler can see here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ...rest, kind: String(component).slice("blocks.".length) } as unknown as Block;
}

/**
 * The owner's identity, navigation, footer and contacts.
 *
 * Every site has a row — the CMS seeds one per owner on boot — so a missing one
 * is a broken deployment, not a state to render around. It throws, and at build
 * time that stops the deploy rather than shipping a site with no navigation.
 */
export async function getSite(ownerKey: Owner["key"]): Promise<Site> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `site:${ownerKey}`);

  const sites = await cms<Site[]>("site-list", [
    ["filters[ownerKey][$eq]", ownerKey],
    ["populate[navigation]", "true"],
    ["populate[headerPhone]", "true"],
    ["populate[headerWhatsapp]", "true"],
    ["populate[contacts]", "true"],
    ["populate[logo]", "true"],
    ["populate[footerColumns][populate]", "links"],
  ]);

  const site = sites[0];
  if (!site) throw new Error(`No Site row for ${ownerKey}. The CMS seeds one on boot.`);
  return site;
}

/** One route's composed sections. `null` when no editor has published it. */
export async function getPage(ownerKey: Owner["key"], slug: string): Promise<Page | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `page:${ownerKey}:${slug}`);

  type RawPage = Omit<Page, "blocks"> & { blocks: Record<string, unknown>[] };
  const pages = await cms<RawPage[]>("page-list", [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[slug][$eq]", slug],
    ...BLOCK_POPULATE,
  ]);

  const page = pages[0];
  return page ? { ...page, blocks: page.blocks.map(toBlock) } : null;
}

/**
 * Both types, newest first, without the expiry applied.
 *
 * The expiry cut deliberately does not happen here. A cutoff computed inside a
 * cached function is frozen into the entry: it is not part of the cache key, so
 * it does not bust anything, and a notice that expires at 10:05 would sit on the
 * page until the entry refilled near 11:00. Cache the list, cut it outside.
 */
async function fetchArticles(ownerKey: Owner["key"], limit: number): Promise<Article[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `articles:${ownerKey}`);

  const fields: [string, string][] = [
    ["filters[ownerKey][$eq]", ownerKey],
    ["sort[0]", "publishedAt:desc"],
    ["pagination[limit]", String(limit)],
    ["populate[cover]", "true"],
  ];

  const [berita, pengumuman] = await Promise.all([
    cms<Omit<Article, "kind" | "expiresAt">[]>("berita-list", fields),
    cms<Omit<Article, "kind">[]>("pengumuman-list", fields),
  ]);

  return [
    // Only a Pengumuman can expire; a Berita article is permanent by type.
    ...berita.map((entry) => ({ ...entry, kind: "Berita" as const, expiresAt: null })),
    ...pengumuman.map((entry) => ({ ...entry, kind: "Pengumuman" as const })),
  ].toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/**
 * The newest entries across both types, newest first.
 *
 * Strictly by date, with no pinning: pinning is how the old SMK homepage ended
 * up telling parents a 2026/2027 intake was open on a page last touched in
 * October 2025. An expired Pengumuman drops out for the same reason, and it is
 * cut against the real clock rather than a cached one.
 *
 * A listing can come back short of `limit` when several of the newest entries
 * have expired, which is correct: the alternative is over-fetching on every
 * page to fill a row that nobody promised would be full.
 *
 * `connection()` says out loud what this function does: it reads the clock, so
 * it cannot be prerendered. Without it the build refuses — `Date.now()` is an
 * unstable value during prerender — and the alternative, cutting inside the
 * cached function, freezes the cutoff into the entry for an hour. Callers put
 * it behind `<Suspense>`, so only the listing waits; the entries themselves are
 * still served from `fetchArticles`'s cache.
 */
export async function getArticles(ownerKey: Owner["key"], limit: number): Promise<Article[]> {
  const entries = await fetchArticles(ownerKey, limit);
  await connection();
  const now = Date.now();

  return entries
    .filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now)
    .slice(0, limit);
}
