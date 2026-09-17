import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

import { cutExpired, type Article } from "./articles.ts";
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
  /** `"lat,lng"`. The map is drawn from it, and hidden without it. */
  readonly mapsCoordinates: string | null;
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
  /** Official accounts. `/kontak` draws them; the footer deliberately does not. */
  readonly socials: readonly CmsLink[];
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
  /** The one line under a card's title — an activity's schedule. */
  readonly meta: string | null;
  readonly images: readonly Media[];
};

/**
 * An activity, which carries a glyph a facility does not.
 *
 * The homepage draws activities as icon tiles and facilities as photo cards, so
 * the icon is a field on the record rather than something the block holds: it
 * belongs to the activity, and an editor sets it once wherever the activity is
 * listed. `null` covers a row created before the field existed — Strapi's
 * default only applies to new rows, not to a backfill.
 */
export type Activity = Entry & { readonly icon: ActivityIcon | null };

/**
 * The glyphs an activity can wear, bounded by the CMS enumeration.
 *
 * Three copies of this list exist — the schema, this union, and `ACTIVITY_ICONS`
 * in `sections.tsx` — and they have to move together. The seed direction is held
 * by the compiler; the schema direction is not, so the tile falls back to a star
 * rather than trusting it.
 */
export type ActivityIcon =
  | "kitab"
  | "tenda"
  | "bola"
  | "target"
  | "komputer"
  | "pena"
  | "labu"
  | "mikrofon"
  | "toko"
  | "bintang";

/** One entry with the parts only its own page renders. */
export type FullEntry = Entry & {
  readonly body: string;
  readonly facts: readonly {
    readonly id: number;
    readonly label: string;
    readonly value: string;
  }[];
  readonly seo: Page["seo"];
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

// `Article` lives in `articles.ts` with the functions that cut, group and page
// it, and is re-exported here so a page imports one module per concern.
export type { Article } from "./articles.ts";

/** The icons a value on `/profil` can carry, bounded by the CMS enumeration. */
export type ValueIcon = "kitab" | "perisai" | "kunci" | "tangan" | "orang" | "topi-wisuda";

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
  | {
      readonly kind: "highlights";
      items: readonly { id: number; label: string; value: string }[];
    }
  | {
      readonly kind: "majors";
      head: SectionHead;
      items: readonly {
        id: number;
        code: string | null;
        title: string;
        meta: string | null;
        description: string | null;
        points: string | null;
      }[];
    }
  | { readonly kind: "facilities"; head: SectionHead; items: readonly Entry[] }
  | { readonly kind: "extracurriculars"; head: SectionHead; items: readonly Activity[] }
  | { readonly kind: "achievements"; head: SectionHead; items: readonly Achievement[] }
  | {
      readonly kind: "facts";
      heading: string;
      body: string | null;
      items: readonly { id: number; label: string; value: string }[];
    }
  | {
      readonly kind: "timeline";
      head: SectionHead;
      items: readonly { id: number; year: number; body: string }[];
    }
  | {
      readonly kind: "values";
      head: SectionHead;
      items: readonly { id: number; icon: ValueIcon; title: string; description: string | null }[];
    }
  | {
      readonly kind: "people";
      head: SectionHead;
      items: readonly { id: number; name: string; role: string; photo: Media | null }[];
    }
  | {
      readonly kind: "layers";
      head: SectionHead;
      items: readonly { id: number; title: string; description: string | null }[];
    }
  | { readonly kind: "news"; head: SectionHead; limit: number }
  | { readonly kind: "admission-cta"; heading: string; body: string | null }
  | { readonly kind: "rich-text"; body: string }
  | {
      readonly kind: "contact";
      head: SectionHead;
      showMap: boolean;
      items: readonly {
        id: number;
        title: string;
        description: string | null;
        channelValue: string;
        channelHref: string;
        ctaLabel: string;
        hours: string | null;
        email: string | null;
      }[];
    }
  | {
      readonly kind: "faq";
      head: SectionHead;
      // Strapi gives every repeatable component row an id. It is the only
      // stable key here: two identical questions are an editing mistake the
      // content model does not forbid.
      items: readonly { id: number; question: string; answer: string }[];
    }
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
  ["populate[blocks][on][blocks.highlights][populate]", "*"],
  ["populate[blocks][on][blocks.majors][populate]", "*"],
  ["populate[blocks][on][blocks.news][populate]", "*"],
  ["populate[blocks][on][blocks.admission-cta][populate]", "*"],
  ["populate[blocks][on][blocks.rich-text][populate]", "*"],
  ["populate[blocks][on][blocks.facts][populate]", "*"],
  ["populate[blocks][on][blocks.timeline][populate]", "*"],
  ["populate[blocks][on][blocks.values][populate]", "*"],
  ["populate[blocks][on][blocks.layers][populate]", "*"],
  ["populate[blocks][on][blocks.people][populate][head]", "true"],
  ["populate[blocks][on][blocks.people][populate][items][populate]", "photo"],
  ["populate[blocks][on][blocks.contact][populate][head]", "true"],
  ["populate[blocks][on][blocks.contact][populate][items]", "true"],
  ["populate[blocks][on][blocks.faq][populate][head]", "true"],
  ["populate[blocks][on][blocks.faq][populate][items]", "true"],
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
  return {
    // Same reason as the lists on `Site`: an empty repeatable arrives missing,
    // and every block that has `items` maps over them without asking.
    ...(Array.isArray(rest.items) ? {} : { items: [] }),
    ...rest,
    kind: String(component).slice("blocks.".length),
  } as unknown as Block;
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
    ["populate[socials]", "true"],
    ["populate[logo]", "true"],
    ["populate[footerColumns][populate]", "links"],
  ]);

  const site = sites[0];
  if (!site) throw new Error(`No Site row for ${ownerKey}. The CMS seeds one on boot.`);

  // A repeatable component that no row has filled in yet comes back missing
  // rather than empty, and a CMS still running the previous schema omits it
  // outright. Every list on `Site` is typed non-optional, so without this the
  // first `.map` — on an editor who cleared one field, or on a deploy where the
  // app is ahead of the CMS — is a 500. Defaulted here rather than at each use:
  // there is one read, and a dozen places that iterate what it returns.
  return {
    ...site,
    navigation: site.navigation ?? [],
    footerColumns: site.footerColumns ?? [],
    contacts: site.contacts ?? [],
    socials: site.socials ?? [],
  };
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
  // Same defaulting as `getSite` and `toBlock`: an empty dynamic zone arrives
  // missing rather than empty, and `/berita` is the first page whose row has no
  // blocks at all — the listing is not something an editor composes.
  return page ? { ...page, blocks: (page.blocks ?? []).map(toBlock) } : null;
}

/**
 * Every entry an owner has published, both types, newest first, with the expiry
 * not yet applied.
 *
 * One read serves the whole `/berita` page — the listing, the archive counts and
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
  cacheLife("hours");
  cacheTag(CMS_TAG, `articles:${ownerKey}`);

  /** Walks Strapi's pages until a short one says there are no more. */
  async function all<T>(collection: string): Promise<T[]> {
    const rows: T[] = [];

    for (let page = 1; ; page += 1) {
      // Sequential on purpose: how many pages exist is only known from the
      // previous one's length, so there is nothing to run in parallel.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const batch = await cms<T[]>(collection, [
        ["filters[ownerKey][$eq]", ownerKey],
        ["sort[0]", "publishedAt:desc"],
        ["pagination[page]", String(page)],
        ["pagination[pageSize]", String(PAGE_LIMIT)],
        ["populate[cover]", "true"],
      ]);

      rows.push(...batch);
      if (batch.length < PAGE_LIMIT) return rows;
    }
  }

  const [berita, pengumuman] = await Promise.all([
    all<Omit<Article, "kind" | "expiresAt">>("berita-list"),
    all<Omit<Article, "kind">>("pengumuman-list"),
  ]);

  return [
    // Only a Pengumuman can expire; a Berita article is permanent by type.
    ...berita.map((entry) => ({ ...entry, kind: "Berita" as const, expiresAt: null })),
    ...pengumuman.map((entry) => ({ ...entry, kind: "Pengumuman" as const })),
  ].toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** `maxLimit` in `apps/cms/config/api.ts`. Asking for more is rejected, not clamped. */
const PAGE_LIMIT = 100;

/**
 * Every unexpired entry, newest first, cut against the real clock.
 *
 * Strictly by date, with no pinning: pinning is how the old SMK homepage ended
 * up telling parents a 2026/2027 intake was open on a page last touched in
 * October 2025. An expired Pengumuman drops out for the same reason.
 *
 * `connection()` says out loud what this does: it reads the clock, so it cannot
 * be prerendered. Without it the build refuses — `Date.now()` is an unstable
 * value during prerender — and the alternative, cutting inside the cached
 * function, freezes the cutoff for an hour. Callers put it behind `<Suspense>`,
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
export const getArticles = async (ownerKey: Owner["key"], limit: number): Promise<Article[]> =>
  (await getArticleIndex(ownerKey)).slice(0, limit);

/** One article, with the parts only its own page renders. */
export type FullArticle = Article & {
  readonly body: string;
  readonly attribution: string | null;
  readonly seo: Page["seo"];
};

/**
 * One entry by address, looked for in both collections.
 *
 * `/berita` is one listing over two types, so a slug there is one address space:
 * the CMS's `uniqueSlugPerOwner` lifecycle checks Berita and Pengumuman against
 * each other, which is what makes "whichever answers" safe rather than a guess.
 *
 * No expiry cut here, deliberately. `expiresAt` means "drops out of listings" —
 * the schema says so — and a notice somebody bookmarked or was sent by WhatsApp
 * should still open rather than 404. It carries its own publication date, which
 * is what dates it.
 */
export async function getArticle(
  ownerKey: Owner["key"],
  slug: string,
): Promise<FullArticle | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `article:${ownerKey}:${slug}`);

  const fields: [string, string][] = [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[slug][$eq]", slug],
    ["populate[cover]", "true"],
    ["populate[seo][populate]", "*"],
  ];

  const [berita, pengumuman] = await Promise.all([
    cms<Omit<FullArticle, "kind" | "expiresAt">[]>("berita-list", fields),
    cms<Omit<FullArticle, "kind">[]>("pengumuman-list", fields),
  ]);

  const article = berita[0];
  if (article) return { ...article, kind: "Berita", expiresAt: null };

  const notice = pengumuman[0];
  return notice ? { ...notice, kind: "Pengumuman" } : null;
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
  cacheLife("hours");
  cacheTag(CMS_TAG, `achievement-for:${ownerKey}:${slug}`);

  const found = await cms<Achievement[]>("pencapaian-list", [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[berita][slug][$eq]", slug],
    ["populate[berita]", "true"],
  ]);

  return found[0] ?? null;
}

/**
 * The collections whose records each own a page. Activities today; facilities
 * are the same shape and join this union when `/fasilitas` is built.
 *
 * The parameter exists rather than a function per collection for the reason
 * `seedEntries` in `apps/cms` takes a uid: only the rows differ. `fasilitas-list`
 * is deliberately **not** listed yet — its schema carries neither `meta` nor
 * `facts`, so `getEntry` would send `populate[facts]` for an attribute that does
 * not exist, and Strapi answers 400 rather than ignoring it. Add the fields and
 * the literal together.
 */
type EntryCollection = "ekstrakurikuler-list";

/**
 * Everything an owner has published in one collection, for its listing page.
 *
 * Unpaged, unlike `/berita`: a school runs a handful of activities and owns a
 * handful of buildings, the canvas draws them all on one screen, and `PAGE_LIMIT`
 * is the ceiling either would have to pass before that stops being true.
 */
export async function getEntries(
  ownerKey: Owner["key"],
  collection: EntryCollection,
): Promise<Entry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `entries:${collection}:${ownerKey}`);

  const entries = await cms<Entry[]>(collection, [
    ["filters[ownerKey][$eq]", ownerKey],
    ["sort[0]", "title:asc"],
    ["pagination[pageSize]", String(PAGE_LIMIT)],
    ["populate[images]", "true"],
  ]);

  // An entry nobody has given a photograph arrives with `images` missing rather
  // than empty, and the card reads `images[0]` without asking. Same defaulting
  // as `getSite` and `toBlock`, for the same reason.
  return entries.map((entry) => ({ ...entry, images: entry.images ?? [] }));
}

/** One entry by address, or `null` when this owner has never published it. */
export async function getEntry(
  ownerKey: Owner["key"],
  collection: EntryCollection,
  slug: string,
): Promise<FullEntry | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CMS_TAG, `entry:${collection}:${ownerKey}:${slug}`);

  const found = await cms<FullEntry[]>(collection, [
    ["filters[ownerKey][$eq]", ownerKey],
    ["filters[slug][$eq]", slug],
    ["populate[images]", "true"],
    ["populate[facts]", "true"],
    ["populate[seo][populate]", "*"],
  ]);

  const entry = found[0];
  // Same defaulting as `getSite` and `toBlock`: a repeatable nobody has filled
  // in arrives missing rather than empty, so the panel below would be a 500 on
  // the first entry an editor leaves without facts.
  return entry ? { ...entry, facts: entry.facts ?? [], images: entry.images ?? [] } : null;
}
