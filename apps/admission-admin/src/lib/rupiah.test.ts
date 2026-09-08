import { describe, expect, it } from "vitest";

import { formatRupiah, reformatRupiah } from "./rupiah.ts";

describe("formatRupiah", () => {
  it("groups thousands the Indonesian way", () => {
    expect(formatRupiah("250000")).toBe("250.000");
  });

  it("is empty for an empty field, not zero", () => {
    expect(formatRupiah("")).toBe("");
  });

  it("drops leading zeros", () => {
    expect(formatRupiah("00250")).toBe("250");
  });

  it("stays exact past the safe integer range", () => {
    expect(formatRupiah("9007199254740993")).toBe("9.007.199.254.740.993");
  });
});

describe("reformatRupiah", () => {
  it("keeps the caret after the digit just typed", () => {
    // "25000" with the caret at the end becomes "25.000"; the caret belongs
    // after the last digit, at 6, not back at 5.
    expect(reformatRupiah("25000", 5)).toEqual({
      digits: "25000",
      formatted: "25.000",
      caret: 6,
    });
  });

  // The case a naive implementation gets wrong: editing mid-number sends the
  // caret to the end and the next keystroke lands in the wrong place.
  it("keeps the caret in the middle when a digit is inserted there", () => {
    // "2950.000" — a 9 typed after the 2 of "250.000".
    expect(reformatRupiah("2950.000", 2)).toEqual({
      digits: "2950000",
      formatted: "2.950.000",
      caret: 3,
    });
  });

  // A caret parked just past a separator lands just before it instead — same
  // place as far as the next keystroke is concerned, since nothing can be typed
  // between a separator and the digit it follows.
  it("counts digits, not separators, when the caret sits after one", () => {
    expect(reformatRupiah("250.000", 4).caret).toBe(3);
  });

  it("stays at the start of an emptied field", () => {
    expect(reformatRupiah("", 0)).toEqual({ digits: "", formatted: "", caret: 0 });
  });
});
