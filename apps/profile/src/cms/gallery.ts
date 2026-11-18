import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import type { Owner } from "@/owners.ts";

import { cms, CMS_TAG, list, type Media, MediaRow, PAGE_LIMIT } from "./client.ts";
import type { Page } from "./pages.ts";

/** One activity's photographs, for `/galeri`. The first photo is the cover. */
export type Album = {
  readonly slug: string;
  readonly title: string;
  /** `YYYY-MM-DD`: the day of the activity, which is what the gallery sorts by. */
  readonly date: string;
  readonly photos: readonly Media[];
};

const AlbumRow = z.looseObject({ photos: list(MediaRow) });

/** Every album an owner has published, newest activity first. */
export async function getAlbums(ownerKey: Owner["key"]): Promise<Album[]> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `albums:${ownerKey}`);

  // Every photo comes along, not just the cover: the card shows the count, and
  // a school runs nowhere near `PAGE_LIMIT` activities a year.
  return cms<Album>(
    "album-list",
    [
      ["filters[ownerKey][$eq]", ownerKey],
      ["sort[0]", "date:desc"],
      ["pagination[pageSize]", String(PAGE_LIMIT)],
      ["populate[photos]", "true"],
    ],
    AlbumRow,
  );
}

/** One album by address, or `null` when this owner has never published it. */
export async function getAlbum(
  ownerKey: Owner["key"],
  slug: string,
): Promise<(Album & { readonly seo: Page["seo"] }) | null> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `album:${ownerKey}:${slug}`);

  const found = await cms<Album & { seo: Page["seo"] }>(
    "album-list",
    [
      ["filters[ownerKey][$eq]", ownerKey],
      ["filters[slug][$eq]", slug],
      ["populate[photos]", "true"],
      ["populate[seo][populate]", "*"],
    ],
    AlbumRow,
  );

  return found[0] ?? null;
}
