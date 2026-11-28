import { describe, expect, it } from "vitest";

import { finishedMilestones, isSchoolKey, SCHOOL_KEYS } from "./index.ts";

describe("school keys", () => {
  it("covers every school key", () => {
    expect(SCHOOL_KEYS).toEqual(["smp", "smk", "sma"]);
  });

  it("narrows a string read from the database", () => {
    expect(isSchoolKey("sma")).toBe(true);
    expect(isSchoolKey("mbs")).toBe(false);
  });
});

describe("finished milestones", () => {
  const submitted = [{ command: "SUBMIT", at: "2026-01-02T03:00:00.000Z" }] as const;

  it("counts payment as finished when there is nothing to pay", () => {
    expect(finishedMilestones(submitted, { registrationFee: 0 })).toEqual({
      REGISTRATION: "2026-01-02T03:00:00.000Z",
      PAYMENT: "2026-01-02T03:00:00.000Z",
    });
  });

  it("leaves payment waiting when a fee is due", () => {
    expect(finishedMilestones(submitted, { registrationFee: 150_000 })).toEqual({
      REGISTRATION: "2026-01-02T03:00:00.000Z",
    });
  });
});
