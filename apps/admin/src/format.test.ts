import { describe, expect, it } from "vitest";

import { formatAgo, formatStamp, formatWaited, initials } from "./format.ts";

// 00.03 WITA on 25 November 2026.
const NOW = new Date("2026-11-24T16:03:00.000Z");

describe("initials", () => {
  it.each([
    ["Nadia Putri Lestari", "NL"],
    ["'Aisyah Al-Humaira", "AA"],
    ["A", "A"],
    ["李小龍 王", "李王"],
    ["Budi 🌟 Santoso", "BS"],
  ])("takes the first and last word of %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("times in Samarinda", () => {
  it("counts minutes across midnight instead of calling it yesterday", () => {
    expect(formatAgo("2026-11-24T15:58:00.000Z", NOW)).toBe("5 menit lalu");
  });

  it("calls the WITA day before yesterday, whatever the server's zone", () => {
    expect(formatAgo("2026-11-24T02:00:00.000Z", NOW)).toBe("kemarin");
    expect(formatStamp("2026-11-24T16:01:00.000Z", NOW)).toBe("Hari ini, 00.01 WITA");
    expect(formatStamp("2026-11-24T02:10:00.000Z", NOW)).toBe("Kemarin, 10.10 WITA");
  });

  it("rounds a wait down", () => {
    expect(formatWaited("2026-11-20T15:00:00.000Z", NOW)).toBe("4 hari");
    expect(formatWaited("2026-11-24T16:02:30.000Z", NOW)).toBe("1 menit");
  });
});
