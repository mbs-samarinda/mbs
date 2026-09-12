import { describe, expect, it } from "vitest";

import { isSchoolKey, SCHOOL_KEYS } from "./index.ts";

describe("school keys", () => {
  it("covers every school key", () => {
    expect(SCHOOL_KEYS).toEqual(["smp", "smk", "sma"]);
  });

  it("narrows a string read from the database", () => {
    expect(isSchoolKey("sma")).toBe(true);
    expect(isSchoolKey("mbs")).toBe(false);
  });
});
