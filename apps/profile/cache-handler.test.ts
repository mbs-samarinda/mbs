import { chmod, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CacheEntry, CacheHandler } from "next/dist/server/lib/cache-handlers/types";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

/**
 * The three properties slice 4 of the deployment plan requires, and nothing
 * else — this is the store that decides whether a redeploy costs the first
 * visitor a Strapi round trip.
 *
 * The handler reads its directory from the environment when the module loads,
 * so each import below is deliberate: a fresh import is how a *replacement
 * container* is simulated, reading the previous one's files.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mbs-cache-"));
  process.env.PROFILE_CACHE_DIR = dir;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A fresh module instance, as a new container would get. `resetModules` is what
 * makes it fresh: the handler keeps its tag manifest in a module-level variable,
 * so re-importing without this would read memory rather than the files on disk,
 * and the tests would pass without proving anything crosses a container.
 */
async function newContainer(): Promise<CacheHandler> {
  vi.resetModules();
  const mod: { default: CacheHandler } = await import("./cache-handler.ts");
  return mod.default;
}

const entry = (body: string, tags: string[]): CacheEntry => ({
  value: new Response(body).body!,
  tags,
  stale: 60,
  timestamp: Date.now(),
  expire: 3600,
  revalidate: 60,
});

const read = async (result: CacheEntry | undefined) =>
  result ? await new Response(result.value).text() : undefined;

test("an entry written by one container is read by its replacement", async () => {
  const first = await newContainer();
  await first.set("site:smp", Promise.resolve(entry("<html>smp</html>", ["cms"])));

  const replacement = await newContainer();
  expect(await read(await replacement.get("site:smp", []))).toBe("<html>smp</html>");
});

test("a revalidated tag invalidates entries a previous container wrote", async () => {
  const first = await newContainer();
  await first.set("page:smp:home", Promise.resolve(entry("old", ["cms"])));

  // What `revalidateTag(CMS_TAG, "max")` in the publish webhook reaches.
  const replacement = await newContainer();
  await replacement.updateTags(["cms"]);

  // A third container, so the manifest is read from disk rather than memory.
  const third = await newContainer();
  expect(await third.get("page:smp:home", [])).toBeUndefined();
});

test("an entry is served back repeatedly, since a stream is consumed once", async () => {
  const handler = await newContainer();
  await handler.set("site:sma", Promise.resolve(entry("twice", ["cms"])));

  expect(await read(await handler.get("site:sma", []))).toBe("twice");
  expect(await read(await handler.get("site:sma", []))).toBe("twice");
});

test("an expired entry is a miss", async () => {
  const handler = await newContainer();
  await handler.set(
    "site:stale",
    Promise.resolve({ ...entry("gone", ["cms"]), timestamp: Date.now() - 7200_000, expire: 3600 }),
  );

  expect(await handler.get("site:stale", [])).toBeUndefined();
});

test("a key never written is a miss rather than a throw", async () => {
  const handler = await newContainer();
  expect(await handler.get("site:absent", [])).toBeUndefined();
});

test("content a day and a half old is still served, so a Strapi outage past a day keeps pages up", async () => {
  const { default: config } = await import("./next.config.ts");
  const content = config.cacheLife?.content;
  const handler = await newContainer();
  await handler.set(
    "site:outage",
    Promise.resolve({
      ...entry("kept", ["albums:smp"]),
      timestamp: Date.now() - 36 * 3600_000,
      revalidate: content?.revalidate ?? 0,
      expire: content?.expire ?? 0,
    }),
  );

  expect(await read(await handler.get("site:outage", []))).toBe("kept");
});

test("two publishes at once both record their tags", async () => {
  const handler = await newContainer();
  await handler.set("publish:a", Promise.resolve(entry("a", ["publish:a"])));
  await handler.set("publish:b", Promise.resolve(entry("b", ["publish:b"])));
  await Promise.all([handler.updateTags(["publish:a"]), handler.updateTags(["publish:b"])]);

  const replacement = await newContainer();
  expect(await replacement.get("publish:a", [])).toBeUndefined();
  expect(await replacement.get("publish:b", [])).toBeUndefined();
});

// What the publish webhook sends: `revalidateTag(CMS_TAG, "max")` reaches the
// handler as `updateTags(["cms"], { expire: <max's expire> })`.
const MAX = { expire: 365 * 24 * 3600 };

test("a publish serves the old entry once more and asks Next to refill it", async () => {
  const first = await newContainer();
  await first.set(
    "page:smp:profil",
    Promise.resolve({ ...entry("old", ["cms"]), timestamp: Date.now() - 1000 }),
  );
  await first.updateTags(["cms"], MAX);

  const replacement = await newContainer();
  const result = await replacement.get("page:smp:profil", []);
  expect(await read(result)).toBe("old");
  expect(result?.revalidate).toBeLessThan(0);
});

test("an entry refilled after a publish is fresh again", async () => {
  const handler = await newContainer();
  await handler.updateTags(["refill"], MAX);
  await handler.set(
    "page:smp:refill",
    Promise.resolve({ ...entry("new", ["refill"]), timestamp: Date.now() + 1 }),
  );

  expect((await handler.get("page:smp:refill", []))?.revalidate).toBe(60);
});

test("a stale path tag is checked by get, since getExpiration leaves soft tags to it", async () => {
  const handler = await newContainer();
  await handler.set(
    "page:smp:path",
    Promise.resolve({ ...entry("old", []), timestamp: Date.now() - 1000 }),
  );
  await handler.updateTags(["_N_T_/smp/path"], MAX);

  expect(await handler.getExpiration(["_N_T_/smp/path"])).toBe(Infinity);
  expect((await handler.get("page:smp:path", ["_N_T_/smp/path"]))?.revalidate).toBeLessThan(0);
});

test("a manifest written before tags had a stale mark still reads", async () => {
  const first = await newContainer();
  await first.set(
    "page:smp:legacy",
    Promise.resolve({ ...entry("old", ["legacy"]), timestamp: Date.now() - 2000 }),
  );
  await writeFile(join(dir, "tags.json"), JSON.stringify({ legacy: Date.now() - 1000 }));

  const replacement = await newContainer();
  expect(await replacement.get("page:smp:legacy", [])).toBeUndefined();
  await replacement.updateTags(["other"], MAX);
  expect(await newContainer().then((h) => h.get("page:smp:legacy", []))).toBeUndefined();
});

test("a manifest that cannot be read fails the publish instead of being overwritten", async () => {
  const handler = await newContainer();
  await handler.updateTags(["kept"]);
  const tags = join(dir, "tags.json");
  const before = await readFile(tags, "utf8");

  await chmod(tags, 0o000);
  try {
    await expect((await newContainer()).updateTags(["other"])).rejects.toThrow();
  } finally {
    await chmod(tags, 0o600);
  }
  expect(await readFile(tags, "utf8")).toBe(before);
});

test("a restart deep in an outage keeps entries still inside their expire", async () => {
  const writer = await newContainer();
  await writer.set(
    "page:smp:outage",
    Promise.resolve({
      ...entry("kept", []),
      timestamp: Date.now() - 30 * 86400_000,
      expire: MAX.expire,
    }),
  );
  await writer.set(
    "page:smp:dead",
    Promise.resolve({ ...entry("gone", []), timestamp: Date.now() - 2 * 3600_000, expire: 3600 }),
  );
  const month = new Date(Date.now() - 30 * 86400_000);
  const names = await readdir(join(dir, "entries"));
  await Promise.all(names.map((name) => utimes(join(dir, "entries", name), month, month)));
  const before = (await readdir(join(dir, "entries"))).length;

  const restarted = await newContainer();
  await restarted.refreshTags();
  expect(await read(await restarted.get("page:smp:outage", []))).toBe("kept");
  expect((await readdir(join(dir, "entries"))).length).toBeLessThan(before);
});

test("a write whose stream never ends does not hang later reads of that key", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const handler = await newContainer();
    const never = new ReadableStream<Uint8Array>({ start: () => {} });
    void handler.set("page:smp:hung", Promise.resolve({ ...entry("", []), value: never }));

    // Without the limit this read never settles and the test times out.
    const pendingRead = handler.get("page:smp:hung", []);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pendingRead).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("a write whose stream errors is a miss, not a partial entry", async () => {
  const handler = await newContainer();
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("half"));
      controller.error(new Error("render aborted"));
    },
  });
  await handler.set("page:smp:broken", Promise.resolve({ ...entry("", []), value: broken }));

  expect(await handler.get("page:smp:broken", [])).toBeUndefined();
});

test("every cacheLife in cms.ts names a profile that exists", async () => {
  // `cacheLife` accepts any string, so a typo compiles and fails every page at runtime.
  const { default: config } = await import("./next.config.ts");
  const source = await readFile(join(import.meta.dirname, "src/cms.ts"), "utf8");
  const used = [...source.matchAll(/cacheLife\("([^"]+)"\)/g)].map((match) => match[1]);

  expect(used.length).toBeGreaterThan(0);
  for (const name of used) expect(Object.keys(config.cacheLife ?? {})).toContain(name);
});
