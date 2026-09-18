import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CacheHandler,
  CacheEntry,
  Timestamp,
} from "next/dist/server/lib/cache-handlers/types";
import { z } from "zod";

/**
 * A file-backed `"use cache"` store, so content survives a container.
 *
 * Next 16.3.4 ships only a memory-backed default handler, which means every
 * deploy and every restart starts cold and the first visitor to each page waits
 * on a Strapi round trip. Pointing `cacheHandlers.default` here, with the
 * directory on a compose volume, makes the previous container's entries
 * readable by its replacement — and makes Strapi being down during a deploy
 * stop mattering.
 *
 * Written rather than installed: there is no file-backed handler for this
 * interface in the package. The interface is the five methods in
 * `next/dist/server/lib/cache-handlers/types.d.ts`.
 *
 * Scope, deliberately: one writer. The site runs a single profile replica, plus
 * a deploy candidate that only ever runs against this directory when it is
 * about to go live. Nothing here coordinates concurrent writers beyond atomic
 * renames, because nothing needs to.
 */

const DIR = process.env.PROFILE_CACHE_DIR ?? "/app/.cache/content";
const ENTRIES = join(DIR, "entries");
const TAGS = join(DIR, "tags.json");

/** Filenames have to be safe, and cache keys are long and arbitrary. */
const fileFor = (cacheKey: string) =>
  join(ENTRIES, createHash("sha256").update(cacheKey).digest("hex"));

/**
 * Everything about an entry except the body. Parsed rather than asserted:
 * `JSON.parse` returns `any`, and these files are read back after a container
 * replacement or an interrupted write, so "the shape I expect" is an assumption
 * about a file on disk rather than about my own code. A file that fails this is
 * treated as a miss.
 */
const MetaSchema = z.object({
  tags: z.array(z.string()),
  stale: z.number(),
  timestamp: z.number(),
  expire: z.number(),
  revalidate: z.number(),
}) satisfies z.ZodType<Omit<CacheEntry, "value">>;

type Meta = z.infer<typeof MetaSchema>;

const TagsSchema = z.record(z.string(), z.number());

/**
 * Tag name to the time it was last revalidated. Read from disk on first use and
 * whenever Next asks, so a revalidate by one process is seen by another.
 */
let tags: Record<string, Timestamp> | null = null;

async function loadTags(): Promise<Record<string, Timestamp>> {
  try {
    tags = TagsSchema.parse(JSON.parse(await readFile(TAGS, "utf8")));
  } catch {
    // Absent on a fresh volume, and unreadable if a write was interrupted.
    // Either way an empty manifest is correct: nothing is known to be stale, so
    // entries are served and the next revalidate rewrites this.
    tags = {};
  }
  return tags;
}

/**
 * `set` hands us a promise that may still be streaming. A `get` for the same
 * key before it settles has to wait for it rather than report a miss — reporting
 * a miss would send a second request to Strapi for something already on its way.
 */
const pending = new Map<string, Promise<void>>();

async function writeEntry(cacheKey: string, entry: CacheEntry): Promise<void> {
  const body = Buffer.from(await new Response(entry.value).arrayBuffer());
  const meta: Meta = {
    tags: entry.tags,
    stale: entry.stale,
    timestamp: entry.timestamp,
    expire: entry.expire,
    revalidate: entry.revalidate,
  };

  await mkdir(ENTRIES, { recursive: true });
  const path = fileFor(cacheKey);
  // Written to a temporary name and renamed, so a reader never sees half a
  // body. A crash mid-write leaves the .tmp behind and the old entry intact.
  await writeFile(`${path}.tmp`, body);
  await writeFile(`${path}.meta.tmp`, JSON.stringify(meta));
  await rename(`${path}.tmp`, path);
  await rename(`${path}.meta.tmp`, `${path}.meta`);
}

const handler: CacheHandler = {
  async get(cacheKey, softTags) {
    await pending.get(cacheKey)?.catch(() => {});

    const path = fileFor(cacheKey);
    let meta: Meta;
    let body: Buffer;
    try {
      [meta, body] = await Promise.all([
        readFile(`${path}.meta`, "utf8").then((text) => MetaSchema.parse(JSON.parse(text))),
        readFile(path),
      ]);
    } catch {
      return undefined;
    }

    const now = Date.now();
    const age = (now - meta.timestamp) / 1000;
    if (age > meta.expire) {
      // Past its life, not merely stale. Removed rather than left to be
      // stepped over on every request.
      await Promise.all([rm(path, { force: true }), rm(`${path}.meta`, { force: true })]);
      return undefined;
    }

    // A tag revalidated after this entry was written makes it invalid, whatever
    // its own expiry says. This is how the CMS publish webhook reaches entries
    // that a previous container wrote.
    const manifest = tags ?? (await loadTags());
    const invalidatedAt = Math.max(
      0,
      ...[...meta.tags, ...softTags].map((tag) => manifest[tag] ?? 0),
    );
    if (invalidatedAt > meta.timestamp) return undefined;

    return {
      ...meta,
      // A fresh stream per call: a ReadableStream is consumed once, and this
      // entry may be served many times.
      value: new Response(body).body!,
    };
  },

  async set(cacheKey, pendingEntry) {
    const write = (async () => {
      try {
        await writeEntry(cacheKey, await pendingEntry);
      } catch {
        // A failed write must not fail the request. The page is already
        // rendered; the only cost is a miss next time.
      }
    })();
    pending.set(cacheKey, write);
    try {
      await write;
    } finally {
      pending.delete(cacheKey);
    }
  },

  async refreshTags() {
    await loadTags();
  },

  async getExpiration(tagNames) {
    const manifest = tags ?? (await loadTags());
    return Math.max(0, ...tagNames.map((tag) => manifest[tag] ?? 0));
  },

  async updateTags(tagNames) {
    const manifest = tags ?? (await loadTags());
    const now = Date.now();
    for (const tag of tagNames) manifest[tag] = now;

    await mkdir(DIR, { recursive: true });
    await writeFile(`${TAGS}.tmp`, JSON.stringify(manifest));
    await rename(`${TAGS}.tmp`, TAGS);
  },
};

export default handler;
