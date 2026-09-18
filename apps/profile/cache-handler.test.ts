import { mkdtemp, rm } from "node:fs/promises";
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
