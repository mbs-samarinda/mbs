import { afterEach, describe, expect, test, vi } from "vitest";

import { getArticleIndex } from "./articles.ts";

// `cacheLife` throws outside a Next server; the reads are tested here as functions.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));

const article = (slug: string) => ({
  slug,
  title: slug,
  publishedAt: "2026-01-01",
  kolaborasi: [],
});

test("a dropped row does not end the article index early", async () => {
  // One junk row makes page 1 of berita come back 99 long.
  const pages = [
    [...Array.from({ length: 99 }, (_, i) => article(`a${i}`)), "junk"],
    [article("last")],
  ];
  vi.stubGlobal("fetch", async (url: string) => {
    const page = Number(new URL(url).searchParams.get("pagination[page]"));
    const rows = url.includes("/berita-list") ? (pages[page - 1] ?? []) : [];
    return Response.json({ data: rows });
  });
  try {
    const slugs = (await getArticleIndex("smp")).map((entry) => entry.slug);
    expect(slugs).toContain("last");
  } finally {
    vi.unstubAllGlobals();
  }
});

// Answers every page the same, and gives up long after a correct reader would.
const repeat = (rows: unknown[]) => {
  let calls = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    calls += 1;
    if (calls > 1000) throw new Error("still paging");
    return Response.json({ data: url.includes("/berita-list") ? rows : [] });
  });
  return () => calls;
};

describe("a CMS that ignores the page parameter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("stops at a short page instead of repeating it", async () => {
    repeat([article("a"), article("b")]);
    const slugs = (await getArticleIndex("smp")).map((entry) => entry.slug);
    expect(slugs).toEqual(["a", "b"]);
  });

  test("throws, naming the collection, when every page is full", async () => {
    const calls = repeat(Array.from({ length: 100 }, (_, i) => article(`a${i}`)));
    await expect(getArticleIndex("smp")).rejects.toThrow("full pages of berita-list");
    expect(calls()).toBeLessThan(1000);
  });
});
