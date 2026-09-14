import { describe, expect, test } from "vitest";

import { cutExpired, filterArticles, monthKey, monthsOf, paginate, PAGE_SIZE } from "./articles.ts";
import type { Article } from "./cms.ts";

const entry = (slug: string, publishedAt: string, extra: Partial<Article> = {}): Article => ({
  kind: "Berita",
  slug,
  title: slug,
  summary: null,
  cover: null,
  publishedAt,
  expiresAt: null,
  ...extra,
});

describe("the expiry cut", () => {
  const now = Date.parse("2026-09-14T02:00:00Z");

  test("drops a notice whose time has passed and keeps one that has not", () => {
    const entries = [
      entry("gone", "2026-09-01T00:00:00Z", {
        kind: "Pengumuman",
        expiresAt: "2026-09-14T01:59:00Z",
      }),
      entry("live", "2026-09-01T00:00:00Z", {
        kind: "Pengumuman",
        expiresAt: "2026-09-14T02:01:00Z",
      }),
      entry("permanent", "2026-09-01T00:00:00Z"),
    ];

    expect(cutExpired(entries, now).map((item) => item.slug)).toEqual(["live", "permanent"]);
  });
});

describe("months", () => {
  test("an entry published late on the 31st UTC belongs to the next month in Samarinda", () => {
    // 17.00 UTC on 31 August is 01.00 on 1 September in WITA. Counting it under
    // August would put it in a month whose link never shows it.
    expect(monthKey("2026-08-31T17:00:00Z")).toBe("2026-09");
  });

  test("counts every month it holds, newest first", () => {
    const months = monthsOf([
      entry("a", "2026-09-02T03:00:00Z"),
      entry("b", "2026-09-01T03:00:00Z"),
      entry("c", "2026-08-20T03:00:00Z"),
    ]);

    expect(months).toEqual([
      { key: "2026-09", label: "September 2026", count: 2 },
      { key: "2026-08", label: "Agustus 2026", count: 1 },
    ]);
  });

  test("a month's count matches what its own link renders", () => {
    const entries = [
      entry("a", "2026-09-02T03:00:00Z"),
      entry("b", "2026-08-20T03:00:00Z"),
      entry("c", "2026-08-01T03:00:00Z"),
    ];

    for (const month of monthsOf(entries)) {
      expect(filterArticles(entries, { month: month.key })).toHaveLength(month.count);
    }
  });
});

describe("filtering", () => {
  const entries = [
    entry("berita", "2026-09-02T03:00:00Z"),
    entry("notice", "2026-09-01T03:00:00Z", { kind: "Pengumuman" }),
  ];

  test("keeps one collection", () => {
    expect(filterArticles(entries, { type: "pengumuman" }).map((item) => item.slug)).toEqual([
      "notice",
    ]);
  });
});

describe("paging", () => {
  const entries = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, index) =>
    entry(`entry-${index}`, "2026-09-02T03:00:00Z"),
  );

  test("splits into full pages and a remainder", () => {
    expect(paginate(entries, 1).entries).toHaveLength(PAGE_SIZE);
    expect(paginate(entries, 3)).toMatchObject({ page: 3, pages: 3, total: entries.length });
    expect(paginate(entries, 3).entries).toHaveLength(3);
  });

  test("a page past the end lands on the last one rather than an empty list", () => {
    // A shared link to `?page=9` on a listing that has since shrunk. An empty
    // page reads as "no news"; the last page reads as what is actually there.
    expect(paginate(entries, 9)).toMatchObject({ page: 3 });
    expect(paginate(entries, 9).entries).toHaveLength(3);
  });

  test("an empty listing still has one page", () => {
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, total: 0 });
  });
});
