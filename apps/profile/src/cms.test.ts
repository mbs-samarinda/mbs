import { afterEach, describe, expect, test, vi } from "vitest";

import { ActivityRow, getPage, PageRow, SiteRow } from "./cms.ts";

// `cacheLife` throws outside a Next server; the reads are tested here as functions.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

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
      await expect(getPage("smp", "profil")).rejects.toThrow();
    },
  );

  test("an empty list is still no page", async () => {
    answer({ data: [] });
    expect(await getPage("smp", "profil")).toBeNull();
  });
});
