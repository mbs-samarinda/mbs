import { draftMode } from "next/headers";
import { z } from "zod";

import { config } from "@/config/env.ts";

/**
 * Everything the profile sites read out of Strapi.
 *
 * Reads are cached rather than fetched per request: this is published content,
 * and the pages are meant to be static. Live admission facts are the opposite
 * case and live in `admission.ts`, uncached, behind a `<Suspense>` boundary.
 *
 * The shapes in this folder are hand-written from the schemas in `apps/cms`,
 * and only the fields that crash a render are parsed at runtime: lists that get
 * mapped, media in those lists, and icon enums used as map keys. A full schema here
 * would be the content model written a second time, drifting from the first.
 * Rows degrade instead of throwing. A strict parse would only move the 500
 * from render time to fetch time, when the page could still show the rest. A
 * response with no `data` list does throw: read as empty it would become a
 * cached 404, and a throw is not cached.
 */

export type Media = {
  readonly url: string;
  readonly alternativeText: string | null;
  readonly width: number;
  readonly height: number;
};

export type CmsLink = { readonly label: string; readonly href: string };

/**
 * The tag every content read carries, and the one the CMS invalidates when an
 * editor publishes. Each reader also
 * tags its rows per owner (`site:<owner>` and the like). Those are finer than anything invalidates today; they cost one string each and are what a
 * per-owner webhook would use.
 */
export const CMS_TAG = "cms";

/** Strapi returns media paths relative to its own host when storage is local. */
export const mediaUrl = (media: Pick<Media, "url">) =>
  media.url.startsWith("http") ? media.url : `${config.cmsUrl}${media.url}`;

/**
 * How long one CMS request may take. A hung Strapi otherwise holds every
 * uncached render open until the visitor gives up. A timeout fails that render
 * fast, and a cached page past its refresh keeps being served.
 */
const CMS_TIMEOUT_MS = 5000;

/**
 * A repeatable as Strapi returns it. An empty one arrives missing rather than
 * as `[]`, and a CMS still on the previous schema omits it outright, so missing
 * becomes `[]`. An item that fails `item` is dropped: one bad row costs that
 * row, not the page.
 */
export const list = <T extends z.ZodType>(item: T) =>
  z
    .unknown()
    .optional()
    .transform((value) =>
      Array.isArray(value)
        ? value.flatMap((row) => {
            const parsed = item.safeParse(row);
            return parsed.success ? [parsed.data] : [];
          })
        : [],
    );

/** Any object. Its fields are trusted to the hand-written types beside each reader. */
export const Row = z.looseObject({});

/** A photo in a list. Without a `url` there is nothing to draw, and `mediaUrl` would throw. */
export const MediaRow = z.looseObject({ url: z.string() });

export async function cms<T>(
  collection: string,
  params: [string, string][],
  row: z.ZodType = Row,
): Promise<T[]> {
  return parseRows<T>(row, await cmsData(collection, params));
}

/**
 * The one assertion in this module. `row` checked the fields that crash a
 * render; the rest of `T` is trusted to the CMS schema.
 */
export function parseRows<T>(row: z.ZodType, data: unknown[]): T[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return list(row).parse(data) as T[];
}

/**
 * The `data` list exactly as Strapi sent it, before any row is checked.
 *
 * In Draft Mode it asks for drafts. Every caller is a `"use cache"` function,
 * which Next re-runs on each draft request and never saves, so drafts never
 * reach a visitor's cache. `draftMode()` is the one request value Next lets a
 * cached function read.
 *
 * Known noise: on each preview render Next 16.4 logs "Unexpected cache miss
 * after cache warming phase" per route, because its warming step expects
 * entries Draft Mode never saves. The page still renders the drafts.
 */
export async function cmsData(collection: string, params: [string, string][]): Promise<unknown[]> {
  const query = new URLSearchParams(params);
  if (!(await draftMode()).isEnabled) return request(collection, query);

  query.set("status", "draft");
  const drafts = await request(collection, query);
  const dated = await withPublishedDates(collection, drafts);
  // Strapi sorted the drafts by a date they do not have; sort again by the one
  // they now carry.
  return query.get("sort[0]") === "publishedAt:desc"
    ? dated.toSorted((a, b) => text(b, "publishedAt").localeCompare(text(a, "publishedAt")))
    : dated;
}

/**
 * A draft has no `publishedAt`: Strapi keeps that on the published version.
 * Every page dates and orders articles and files by it, so each draft takes
 * its published version's date, and one never published takes now, the date
 * it would get if published at this moment.
 */
async function withPublishedDates(collection: string, drafts: unknown[]): Promise<unknown[]> {
  const ids = drafts.map((row) => text(row, "documentId")).filter(Boolean);
  if (ids.length === 0) return drafts;

  const query = new URLSearchParams([
    ["fields[0]", "publishedAt"],
    ["pagination[pageSize]", String(PAGE_LIMIT)],
    ...ids.map((id, i): [string, string] => [`filters[documentId][$in][${i}]`, id]),
  ]);
  const published = new Map(
    (await request(collection, query)).map((row) => [
      text(row, "documentId"),
      text(row, "publishedAt"),
    ]),
  );
  const now = new Date().toISOString();
  return drafts.map((row) =>
    typeof row === "object" && row !== null
      ? { ...row, publishedAt: published.get(text(row, "documentId")) || now }
      : row,
  );
}

/** A string field of a row Strapi sent, or "" when it is missing or not a string. */
const text = (row: unknown, field: string): string => {
  const value: unknown =
    typeof row === "object" && row !== null ? Reflect.get(row, field) : undefined;
  return typeof value === "string" ? value : "";
};

async function request(collection: string, query: URLSearchParams): Promise<unknown[]> {
  const response = await fetch(`${config.cmsUrl}/api/${collection}?${query.toString()}`, {
    signal: AbortSignal.timeout(CMS_TIMEOUT_MS),
    headers: config.cmsReadToken ? { authorization: `Bearer ${config.cmsReadToken}` } : {},
  }).catch((error: unknown) => {
    throw new Error(`CMS request for ${collection} failed`, { cause: error });
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`CMS refused ${collection} (${response.status}): check CMS_READ_TOKEN`);
  }
  if (!response.ok) {
    throw new Error(`CMS returned ${response.status} for ${collection}`);
  }

  const envelope = z
    .looseObject({ data: z.array(z.unknown()) })
    .safeParse(await response.json().catch(() => null));
  if (!envelope.success) throw new Error(`CMS sent no data list for ${collection}`);
  return envelope.data.data;
}

/** `maxLimit` in `apps/cms/config/api.ts`. Asking for more is rejected, not clamped. */
export const PAGE_LIMIT = 100;
