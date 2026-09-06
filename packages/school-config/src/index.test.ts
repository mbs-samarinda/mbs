import { describe, expect, it } from "vitest";
import { schoolFromHostname, SCHOOL_KEYS } from "./index.ts";

describe("schoolFromHostname", () => {
  it("resolves a known subdomain", () => {
    expect(schoolFromHostname("sma.mbss.sch.id")?.key).toBe("sma");
  });

  it("ignores case", () => {
    expect(schoolFromHostname("SMP.mbss.sch.id")?.key).toBe("smp");
  });

  it("returns null for an unknown host", () => {
    expect(schoolFromHostname("admission.mbss.sch.id")).toBeNull();
  });

  it("covers every school key", () => {
    expect(SCHOOL_KEYS).toEqual(["sma", "smp", "sd"]);
  });
});
