import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
 * Next 16.3.4 ships only a memory-backed default handler, so a restart threw
 * away every entry and the next visitor to each page waited on Strapi.
 *
 * What this does and does not buy, stated precisely, because the obvious
 * reading is wrong. Next seeds every cache key with the build id, so a *new
 * image* cannot read an old image's entries — persistence does not carry
 * content across a deploy on its own. What it does carry:
 *
 * - A restart or a crash of the same image keeps everything.
 * - The deploy candidate runs the same image that is about to go live, so the
 *   keys it warms are exactly the keys the live container will ask for. That is
 *   what makes Strapi being down *after* a deploy survivable, and it only works
 *   because the candidate and the live container share this volume.
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

/**
 * One entry is one file: a four-byte big-endian header length, the metadata as
 * JSON, then the body bytes.
 *
 * One file rather than two on purpose. With the metadata beside the body, an
 * overwrite renames them one at a time, and between the two renames a reader
 * sees the new body paired with the previous metadata — so `get` would check
 * fresh content against a stale tag set and timestamp, and could serve an entry
 * a `revalidateTag` should have killed.
 */
async function writeEntry(cacheKey: string, entry: CacheEntry): Promise<void> {
  const body = Buffer.from(await new Response(entry.value).arrayBuffer());
  const meta: Meta = {
    tags: entry.tags,
    stale: entry.stale,
    timestamp: entry.timestamp,
    expire: entry.expire,
    revalidate: entry.revalidate,
  };
  const header = Buffer.from(JSON.stringify(meta), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.byteLength);

  await mkdir(ENTRIES, { recursive: true });
  const path = fileFor(cacheKey);
  // A name nobody else can be using. `pending` serialises get-against-set for
  // one key, not set-against-set: two requests for the same uncached page — the
  // ordinary stampede — both call `set`, and a shared temp name would let them
  // interleave writes and leave a file blended from two different renders.
  const temp = `${path}.${process.pid}.${(counter += 1)}.tmp`;
  try {
    await writeFile(temp, Buffer.concat([length, header, body]));
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

let counter = 0;

/**
 * Removes entry files nothing can reach any more, once per process.
 *
 * Next seeds every `"use cache"` key with the build id — it says so in
 * `use-cache-wrapper.js`, because an Action ID does not yet hash its
 * implementation — so a new image cannot read the previous image's entries at
 * all. Those files are not stale, they are unaddressable, and `get` is the only
 * thing that deletes anything, so nothing would ever look at them again.
 *
 * Left alone that is a whole generation of pages kept per deploy, on a 58 GB
 * box, with the default profile's `expire` measured in decades. Age is the only
 * usable signal: the handler cannot tell which build a file belongs to without
 * reading all of them, and a file untouched for a week is either orphaned or
 * cold enough that one Strapi round trip is cheaper than keeping it.
 */
const SWEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
let swept = false;

async function sweepOnce(): Promise<void> {
  if (swept) return;
  swept = true;

  try {
    const cutoff = Date.now() - SWEEP_AFTER_MS;
    const names = await readdir(ENTRIES);
    await Promise.all(
      names.map(async (name) => {
        const path = join(ENTRIES, name);
        // `.tmp` files are also collected here: an interrupted write leaves one
        // behind, and nothing else ever removes it.
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs < cutoff) await rm(path, { force: true });
      }),
    );
  } catch {
    // A sweep is housekeeping. Failing it must never fail a request.
  }
}

const handler: CacheHandler = {
  async get(cacheKey, softTags) {
    await pending.get(cacheKey)?.catch(() => {});

    const path = fileFor(cacheKey);
    let meta: Meta;
    let body: Buffer;
    try {
      const file = await readFile(path);
      const headerEnd = 4 + file.readUInt32BE(0);
      meta = MetaSchema.parse(JSON.parse(file.subarray(4, headerEnd).toString("utf8")));
      body = file.subarray(headerEnd);
    } catch {
      // Absent, truncated, or written by an older shape of this file. All of
      // them are a miss, which costs one Strapi round trip.
      return undefined;
    }

    const age = (Date.now() - meta.timestamp) / 1000;
    if (age > meta.expire) {
      // Past its life, not merely stale. Removed rather than stepped over on
      // every request.
      await rm(path, { force: true });
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
    await sweepOnce();
  },

  async getExpiration(tagNames) {
    const manifest = tags ?? (await loadTags());
    return Math.max(0, ...tagNames.map((tag) => manifest[tag] ?? 0));
  },

  // The one method here with no `catch`, deliberately. A revalidation this
  // cannot record is content that will keep being served stale, so the publish
  // webhook should fail and say so rather than answer 200 and quietly do
  // nothing. `set` is the opposite case: the page is already rendered and a
  // failed write costs only a miss.
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
