import { describe, expect, it } from "vitest";

import { schoolFromHostname, SCHOOL_KEYS } from "./index.ts";

describe("schoolFromHostname", () => {
  it("resolves a known subdomain", () => {
    expect(schoolFromHostname("sma.mbss.sch.id")?.key).toBe("sma");
  });

  it("ignores case", () => {
    expect(schoolFromHostname("SMK.mbss.sch.id")?.key).toBe("smk");
  });

  it("returns null for an unknown host", () => {
    expect(schoolFromHostname("sd.mbss.sch.id")).toBeNull();
  });

  it("covers every school key", () => {
    expect(SCHOOL_KEYS).toEqual(["smp", "smk", "sma"]);
  });
});
