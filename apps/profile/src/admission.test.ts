import { describe, expect, it } from "vitest";

import { isOpen } from "./admission.ts";

const cycle = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "2027/2028",
  status: "OPEN",
  registrationOpenAt: "2026-09-01T00:00:00.000Z",
  registrationCloseAt: "2027-03-31T00:00:00.000Z",
  resultPublishAt: "2027-04-15T11:00:00.000Z",
  schoolKey: "smk",
  isEnabled: true,
  effectiveFee: 4_500_000,
} as const;

describe("isOpen", () => {
  // Two fields decide this, not one. A cycle the committee has opened but not
  // enabled for a school is closed *for that school*, and reading only `status`
  // would invite a parent to start an application that school is not taking.
  it("is open only when the cycle is open and enabled for the school", () => {
    expect(isOpen(cycle)).toBe(true);
    expect(isOpen({ ...cycle, isEnabled: false })).toBe(false);
    expect(isOpen({ ...cycle, status: "CLOSED" })).toBe(false);
    expect(isOpen({ ...cycle, status: "DRAFT" })).toBe(false);
    expect(isOpen({ ...cycle, status: "ARCHIVED" })).toBe(false);
  });
});
