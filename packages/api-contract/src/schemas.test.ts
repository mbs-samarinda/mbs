import { describe, expect, it } from "vitest";

import { CreateCycleInput, UpsertSchoolSettingInput } from "./schemas.ts";

const cycle = {
  name: "2027/2028",
  registrationOpenAt: "2026-11-01T00:00:00.000Z",
  registrationCloseAt: "2026-12-31T00:00:00.000Z",
  resultPublishAt: "2027-01-15T00:00:00.000Z",
  defaultFee: 250_000,
};

describe("CreateCycleInput", () => {
  it("accepts a well ordered cycle", () => {
    expect(CreateCycleInput.safeParse(cycle).success).toBe(true);
  });

  // The two timestamps are one second apart but compare the other way as
  // strings, because "Z" sorts after ".". Ordering has to run on instants.
  it("compares instants, not ISO strings", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      registrationOpenAt: "2026-11-01T10:00:00Z",
      registrationCloseAt: "2026-11-01T10:00:00.500Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a close before the open", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      registrationCloseAt: "2026-10-01T00:00:00.000Z",
    });

    expect(result.error?.issues[0]?.path).toEqual(["registrationCloseAt"]);
  });

  it("rejects a result published before registration closes", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      resultPublishAt: "2026-12-01T00:00:00.000Z",
    });

    expect(result.error?.issues[0]?.path).toEqual(["resultPublishAt"]);
  });

  // Without the ceiling this reaches Postgres and comes back as a 500.
  it("rejects a fee the integer column cannot hold", () => {
    expect(CreateCycleInput.safeParse({ ...cycle, defaultFee: 3_000_000_000 }).success).toBe(false);
  });
});

describe("UpsertSchoolSettingInput", () => {
  it("rejects a repeated document type", () => {
    const result = UpsertSchoolSettingInput.safeParse({
      cycleId: "00000000-0000-0000-0000-000000000001",
      schoolKey: "sma",
      isEnabled: true,
      feeOverride: null,
      acceptedInstructions: null,
      rejectedInstructions: null,
      documents: [
        { type: "IJAZAH", required: true },
        { type: "IJAZAH", required: false },
      ],
    });

    expect(result.success).toBe(false);
  });
});
