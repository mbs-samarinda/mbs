import { describe, expect, it } from "vitest";

import {
  formatAgo,
  formatRupiah,
  formatStamp,
  formatWaited,
  fromWita,
  initials,
  toWita,
} from "./format.ts";

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

describe("Samarinda form times", () => {
  it("round-trips a day and time through an instant", () => {
    const iso = fromWita("2026-12-01", "08.00");
    expect(iso).toBe("2026-12-01T00:00:00.000Z");
    expect(toWita(iso!)).toEqual({ day: "2026-12-01", time: "08.00" });
  });

  it("refuses a time that is not on the clock", () => {
    expect(fromWita("2026-12-01", "24.00")).toBeNull();
    expect(fromWita("2026-12-01", "8")).toBeNull();
  });

  it("writes rupiah with dots", () => {
    expect(formatRupiah(3_500_000)).toBe("Rp3.500.000");
  });
});
