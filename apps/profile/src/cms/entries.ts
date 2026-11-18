import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import type { Owner } from "@/owners.ts";

import { cms, CMS_TAG, list, type Media, MediaRow, PAGE_LIMIT, Row } from "./client.ts";
import type { Page } from "./pages.ts";

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
 * listed.
 */
export type Activity = Entry & { readonly icon: ActivityIcon };

/**
 * The glyphs an activity can wear, bounded by the CMS enumeration.
 *
 * Two copies of this list exist, the schema and this one, and the compiler
 * holds `ACTIVITY_ICONS` in `app/[owner]/_components/blocks.tsx` to this one.
 * A value the CMS gains before this list does, or a row from before the field
 * existed (Strapi's default lands on new rows only), arrives as `bintang`
 * instead of crashing the homepage.
 */
const ActivityIconSchema = z
  .enum([
    "kitab",
    "tenda",
    "bola",
    "target",
    "komputer",
    "pena",
    "labu",
    "mikrofon",
    "toko",
    "bintang",
  ])
  .catch("bintang");

export type ActivityIcon = z.infer<typeof ActivityIconSchema>;

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

export const EntryRow = z.looseObject({ images: list(MediaRow) });

const FullEntryRow = EntryRow.extend({ facts: list(Row) });

export const ActivityRow = EntryRow.extend({ icon: ActivityIconSchema });

/**
 * The collections whose records each own a page: activities and facilities.
 *
 * The parameter exists rather than a function per collection for the reason
 * `seedEntries` in `apps/cms` takes a uid: the two schemas are the same shape
 * and only the rows differ. A third collection joins by adding its `meta` and
 * `facts` fields and its plural name here in one change — `getEntry` sends
 * `populate[facts]`, and Strapi answers 400 for an attribute that does not
 * exist rather than ignoring it.
 */
export type EntryCollection = "ekstrakurikuler-list" | "fasilitas-list";

/**
 * Everything an owner has published in one collection, for its listing page.
 *
 * Unpaged, unlike `/artikel`: a school runs a handful of activities and owns a
 * handful of buildings, the canvas draws them all on one screen, and `PAGE_LIMIT`
 * is the ceiling either would have to pass before that stops being true.
 */
export async function getEntries(
  ownerKey: Owner["key"],
  collection: EntryCollection,
): Promise<Entry[]> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `entries:${collection}:${ownerKey}`);

  return cms<Entry>(
    collection,
    [
      ["filters[ownerKey][$eq]", ownerKey],
      ["sort[0]", "title:asc"],
      ["pagination[pageSize]", String(PAGE_LIMIT)],
      ["populate[images]", "true"],
    ],
    EntryRow,
  );
}

/** One entry by address, or `null` when this owner has never published it. */
export async function getEntry(
  ownerKey: Owner["key"],
  collection: EntryCollection,
  slug: string,
): Promise<FullEntry | null> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `entry:${collection}:${ownerKey}:${slug}`);

  const found = await cms<FullEntry>(
    collection,
    [
      ["filters[ownerKey][$eq]", ownerKey],
      ["filters[slug][$eq]", slug],
      ["populate[images]", "true"],
      ["populate[facts]", "true"],
      ["populate[seo][populate]", "*"],
    ],
    FullEntryRow,
  );

  return found[0] ?? null;
}
