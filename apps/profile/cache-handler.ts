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
 * Next's own default handler is memory-backed, so a restart threw away every
 * entry and the next visitor to each page waited on Strapi.
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
 * renames and an in-process queue for the tag manifest, because nothing needs to.
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

/**
 * Per tag, the same two marks as Next's in-memory tags manifest. An entry older
 * than `stale` is served once more with `revalidate: -1`, which makes Next
 * refill it in the background; a failed refill writes nothing, so the old entry
 * keeps being served. An entry older than `expired`, once that time arrives, is
 * a miss.
 */
const MarkSchema = z.object({ stale: z.number().optional(), expired: z.number().optional() });

type Mark = z.infer<typeof MarkSchema>;

const TagsSchema = z.record(
  z.string(),
  z.union([
    // The manifest before stale marks existed: a bare time meant expire now.
    z.number().transform((expired): Mark => ({ expired })),
    MarkSchema,
  ]),
);

type Tags = Record<string, Mark>;

/**
 * Read from disk on first use and whenever Next asks, so a revalidate by one
 * process is seen by another.
 */
let tags: Tags | null = null;

/**
 * Only a missing file is an empty manifest. Any other failure throws, and
 * `tags` keeps the last good copy: read as empty, a transient EIO would make
 * `updateTags` overwrite every recorded publish. Readers catch it and serve on
 * the last good copy, or miss when there is none; only `updateTags` lets it
 * fail the publish.
 */
async function loadTags(): Promise<Tags> {
  const text = await readFile(TAGS, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });
  tags = TagsSchema.parse(JSON.parse(text));
  return tags;
}

/**
 * Next stamps `timestamp` from this clock, not `Date.now()`, and the marks are
 * compared against it, so they use the same one.
 */
const now = () => performance.timeOrigin + performance.now();

const isStale = (tag: Mark | undefined, timestamp: Timestamp) => (tag?.stale ?? 0) > timestamp;

// `expired` can lie in the future: a publish with a profile sets it to now plus
// the profile's `expire`. It counts once it has arrived.
const isExpired = (tag: Mark | undefined, timestamp: Timestamp) =>
  tag?.expired !== undefined && tag.expired > timestamp && tag.expired <= now();

/**
 * `set` hands us a promise that may still be streaming. A `get` for the same
 * key before it settles has to wait for it rather than report a miss — reporting
 * a miss would send a second request to Strapi for something already on its way.
 */
const pending = new Map<string, Promise<void>>();

/**
 * How long a `set` may stream before it is dropped. A render aborted mid-write
 * can leave a stream that never ends, and without a limit every later `get` of
 * that key would wait on it until restart. Next gives up on a `"use cache"`
 * fill after 54 seconds (`useCacheTimeout`), so a minute outlives any write
 * that could still finish.
 */
const SET_LIMIT_MS = 60_000;

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
async function writeEntry(cacheKey: string, entry: CacheEntry, body: Buffer): Promise<void> {
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
  await writeAtomically(fileFor(cacheKey), Buffer.concat([length, header, body]));
}

/**
 * Write to a temp file, then rename over the target, so a reader never sees a
 * half-written file. The temp name is unique per write: `pending` serialises
 * get-against-set for one key, not set-against-set. Two requests for the same
 * uncached page, or two publish webhooks at once, would otherwise share a temp
 * file, blend two writes into it, or rename it twice and fail the second.
 */
async function writeAtomically(path: string, data: Buffer | string): Promise<void> {
  const temp = `${path}.${process.pid}.${(counter += 1)}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

let counter = 0;

/** An entry file's parts, or `undefined` when it is truncated or an older shape. */
function parseEntry(file: Buffer): { meta: Meta; body: Buffer } | undefined {
  try {
    const headerEnd = 4 + file.readUInt32BE(0);
    const meta = MetaSchema.parse(JSON.parse(file.subarray(4, headerEnd).toString("utf8")));
    return { meta, body: file.subarray(headerEnd) };
  } catch {
    return undefined;
  }
}

const isPastExpire = (meta: Meta) => now() - meta.timestamp > meta.expire * 1000;

/**
 * Removes entry files past their own `expire`, once per process.
 *
 * Judged on the entry's timestamp, not the file's mtime. During an outage
 * nothing is rewritten, so by mtime a restart a week in would delete every page
 * still being served.
 *
 * The cost is orphans. Next seeds every `"use cache"` key with the build id, so
 * a new image cannot read the previous image's entries, and they now wait out
 * the `content` profile's year. That is a few hundred kilobytes a deploy. Build
 * id is not used instead: the deploy candidate shares this volume with the live
 * container, and a candidate sweeping the live build's entries would leave the
 * site cold if the candidate then failed.
 */
const SWEEP_TMP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
let swept = false;

/**
 * One file at a time, and not awaited by `refreshTags`: it reads every entry,
 * and neither the first request after a restart nor the open-file limit should
 * pay for that. A file that cannot be read is left alone; only one that was
 * read and is past its life or unparsable goes.
 */
async function sweepOnce(): Promise<void> {
  if (swept) return;
  swept = true;

  const names = await readdir(ENTRIES).catch(() => []);
  for (const name of names) {
    const path = join(ENTRIES, name);
    try {
      if (name.endsWith(".tmp")) {
        // Left by an interrupted write. A young one may be another process's
        // write in flight, so only old ones go.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const info = await stat(path);
        // oxlint-disable-next-line eslint/no-await-in-loop
        if (info.mtimeMs < Date.now() - SWEEP_TMP_AFTER_MS) await rm(path, { force: true });
        continue;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      const entry = parseEntry(await readFile(path));
      // oxlint-disable-next-line eslint/no-await-in-loop
      if (!entry || isPastExpire(entry.meta)) await rm(path, { force: true });
    } catch {
      // A sweep is housekeeping. Failing it must never fail a request.
    }
  }
}

const handler: CacheHandler = {
  async get(cacheKey, softTags) {
    await pending.get(cacheKey);

    const path = fileFor(cacheKey);
    // Absent, unreadable or unparsable: a miss, which costs one Strapi round trip.
    const file = await readFile(path).catch(() => undefined);
    const entry = file && parseEntry(file);
    if (!entry) return undefined;
    const { meta, body } = entry;

    if (isPastExpire(meta)) {
      // Past its life, not merely stale. Removed rather than stepped over on
      // every request.
      await rm(path, { force: true });
      return undefined;
    }

    // Soft tags are checked here too, because `getExpiration` returns Infinity.
    // This is how the CMS publish webhook reaches entries that a previous
    // container wrote.
    // With no last good copy there is no way to know what a publish replaced,
    // so an unreadable manifest is a miss.
    const manifest = tags ?? (await loadTags().catch(() => undefined));
    if (!manifest) return undefined;
    const marks = [...meta.tags, ...softTags].map((tag) => manifest[tag]);
    if (marks.some((mark) => isExpired(mark, meta.timestamp))) return undefined;

    return {
      ...meta,
      revalidate: marks.some((mark) => isStale(mark, meta.timestamp)) ? -1 : meta.revalidate,
      // A fresh stream per call: a ReadableStream is consumed once, and this
      // entry may be served many times.
      value: new Response(new Uint8Array(body)).body!,
    };
  },

  async set(cacheKey, pendingEntry) {
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), SET_LIMIT_MS);
    const timedOut = new Promise<never>((_, reject) => {
      limit.signal.addEventListener("abort", () => {
        reject(new Error("set timed out"));
        // An entry that arrives after the limit is never read; release its stream.
        pendingEntry.then((late) => late.value.cancel()).catch(() => {});
      });
    });

    const write = (async () => {
      try {
        const entry = await Promise.race([pendingEntry, timedOut]);
        // Aborting the pipe cancels the stream, so nothing holds it after
        // `set` resolves. An errored or cancelled stream throws
        // here and writes nothing: a partial body is never stored.
        const piped = entry.value.pipeThrough(new TransformStream(), { signal: limit.signal });
        const body = Buffer.from(await new Response(piped).arrayBuffer());
        await writeEntry(cacheKey, entry, body);
      } catch {
        // A failed write must not fail the request. The page is already
        // rendered; the only cost is a miss next time.
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.set(cacheKey, write);
    await write;
    // A second `set` for this key may have replaced ours; its `get`s still wait on it.
    if (pending.get(cacheKey) === write) pending.delete(cacheKey);
  },

  async refreshTags() {
    await loadTags().catch(() => {});
    void sweepOnce();
  },

  // Infinity tells Next to pass soft tags to `get` rather than compare a single
  // time itself. Next's comparison is a hard miss, which would undo the stale
  // mark a publish sets.
  async getExpiration() {
    return Infinity;
  },

  // The one method here with no `catch`, deliberately. A revalidation this
  // cannot record is content that will keep being served stale, so the publish
  // webhook should fail and say so rather than answer 200 and quietly do
  // nothing. `set` is the opposite case: the page is already rendered and a
  // failed write costs only a miss.
  //
  // Queued, and each turn re-reads the file. Two publishes at once would
  // otherwise each load their own copy of the manifest, and the second rename
  // would drop the first one's tag.
  //
  // Marks follow Next's default handler. With `durations` (a profile was named,
  // as the publish webhook's `"max"` is) the tag goes stale now and expires
  // `expire` seconds later. Without, it expires now.
  updateTags(tagNames, durations) {
    const write = tagWrites.then(async () => {
      const manifest = await loadTags();
      const at = now();
      for (const tag of tagNames) {
        manifest[tag] = durations
          ? {
              ...manifest[tag],
              stale: at,
              ...(durations.expire === undefined ? {} : { expired: at + durations.expire * 1000 }),
            }
          : { ...manifest[tag], expired: at };
      }

      await mkdir(DIR, { recursive: true });
      await writeAtomically(TAGS, JSON.stringify(manifest));
    });
    tagWrites = write.catch(() => {});
    return write;
  },
};

let tagWrites = Promise.resolve();

export default handler;
