import { afterEach, describe, expect, test, vi } from "vitest";

import { ActivityRow, getArticleIndex, getPage, PageRow, SiteRow } from "./cms.ts";

// `cacheLife` throws outside a Next server; the reads are tested here as functions.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));

test("a site row with every list missing or broken still parses, with empty lists", () => {
  const site = SiteRow.parse({
    tagline: "Kampus",
    menu: [{ label: "Profil" }, "not a row", null],
    footerColumns: "oops",
    socials: null,
  });

  expect(site).toMatchObject({
    tagline: "Kampus",
    menu: [{ label: "Profil", links: [] }],
    footerColumns: [],
    contacts: [],
    socials: [],
  });
});

test("an icon the CMS added before the site knew it falls back instead of crashing", () => {
  const page = PageRow.parse({
    blocks: [
      {
        __component: "blocks.values",
        items: [
          { id: 1, icon: "roket", title: "Baru" },
          { id: 2, icon: "perisai", title: "Lama" },
        ],
      },
    ],
  });

  expect(page.blocks[0]).toMatchObject({
    kind: "values",
    items: [{ icon: "kitab" }, { icon: "perisai" }],
  });
});

test("an activity from before the icon field existed gets the star", () => {
  expect(ActivityRow.parse({ slug: "pramuka", icon: null })).toMatchObject({
    icon: "bintang",
    images: [],
  });
});

test("a photo with no url is dropped and the rest of the list survives", () => {
  const page = PageRow.parse({
    blocks: [
      {
        __component: "blocks.facilities",
        items: [{ slug: "lab", images: [{ url: "/uploads/lab.jpg" }, { url: null }] }],
      },
    ],
  });

  expect(page.blocks[0]?.items).toEqual([{ slug: "lab", images: [{ url: "/uploads/lab.jpg" }] }]);
});

test("a block keeps its fields, loses the prefix, and gets an empty list when it has none", () => {
  const page = PageRow.parse({
    blocks: [{ __component: "blocks.rich-text", id: 7, body: "Halo" }, { id: 8 }],
  });

  expect(page.blocks).toEqual([{ kind: "rich-text", id: 7, body: "Halo", items: [] }]);
});

test("a page with no blocks has an empty list", () => {
  expect(PageRow.parse({ title: "Artikel" }).blocks).toEqual([]);
});

const answer = (body: unknown) => vi.stubGlobal("fetch", async () => Response.json(body));

describe("a CMS answer without a data list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A page read as `null` renders a 404, and "use cache" would keep it. A throw
  // is not cached, so the next request asks again.
  test.each([{}, { data: {} }, { data: null }])(
    "throws rather than reading as no page: %j",
    async (body) => {
      answer(body);
      await expect(getPage("smp", "profil")).rejects.toThrow("no data list for page-list");
    },
  );

  test("an empty list is still no page", async () => {
    answer({ data: [] });
    expect(await getPage("smp", "profil")).toBeNull();
  });
});

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
