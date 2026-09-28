import { describe, expect, test } from "vitest";

import {
  badgeOwners,
  cutExpired,
  filterArticles,
  monthKey,
  monthsOf,
  paginate,
  PAGE_SIZE,
  umbrellaNews,
} from "./articles.ts";
import type { Article } from "./cms.ts";

const entry = (slug: string, publishedAt: string, extra: Partial<Article> = {}): Article => ({
  kind: "Berita",
  slug,
  title: slug,
  summary: null,
  cover: null,
  publishedAt,
  expiresAt: null,
  ownerKey: "smk",
  collaborators: [],
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

describe("owner badges", () => {
  test("a solo article on its own site names nobody", () => {
    expect(badgeOwners(entry("solo", "2026-09-01T00:00:00Z"), "smk")).toEqual([]);
  });

  test("a collab names the primary first, then its collaborators", () => {
    const collab = entry("collab", "2026-09-01T00:00:00Z", { collaborators: ["smp", "sma"] });
    expect(badgeOwners(collab, "smk")).toEqual(["smk", "smp", "sma"]);
  });

  test("a solo article seen from another site names its owner", () => {
    expect(badgeOwners(entry("solo", "2026-09-01T00:00:00Z"), "mbs")).toEqual(["smk"]);
  });
});

describe("the umbrella's news block", () => {
  const school = (slug: string, day: number) =>
    entry(slug, `2026-09-${day}T00:00:00Z`, { ownerKey: "smp" });
  const umbrella = (slug: string, day: number) =>
    entry(slug, `2026-09-${day}T00:00:00Z`, { ownerKey: "mbs" });

  test("umbrella posts lead, up to half rounded up, then schools by date", () => {
    const entries = [
      school("s1", 20),
      school("s2", 19),
      umbrella("u1", 18),
      school("s3", 17),
      umbrella("u2", 16),
      umbrella("u3", 15),
    ];
    expect(umbrellaNews(entries, 3).map((item) => item.slug)).toEqual(["u1", "u2", "s1"]);
  });

  test("older umbrella posts fill in when the schools run short", () => {
    const entries = [umbrella("u1", 18), school("s1", 17), umbrella("u2", 16), umbrella("u3", 15)];
    expect(umbrellaNews(entries, 4).map((item) => item.slug)).toEqual(["u1", "u2", "s1", "u3"]);
  });
});
