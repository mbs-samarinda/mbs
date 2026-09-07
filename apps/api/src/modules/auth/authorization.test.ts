import { describe, expect, it } from "vitest";

import { ForbiddenError } from "../../errors.ts";
import { requireRole, requireSchoolAccess, type StaffContext } from "./authorization.ts";

const principal: StaffContext = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Kepala Sekolah",
  role: "PRINCIPAL",
  schoolKeys: ["sma"],
  authUserId: "auth-1",
};

describe("requireRole", () => {
  it("lets a listed role through", () => {
    expect(() => requireRole(principal, "PRINCIPAL", "ADMINISTRATOR")).not.toThrow();
  });

  it("refuses a role that is not listed", () => {
    expect(() => requireRole(principal, "ADMINISTRATOR")).toThrow(ForbiddenError);
  });
});

describe("requireSchoolAccess", () => {
  it("allows an assigned school", () => {
    expect(() => requireSchoolAccess(principal, "sma")).not.toThrow();
  });

  // The whole point of keeping role and scope apart: a powerful role still
  // cannot reach a school nobody assigned.
  it("refuses an unassigned school whatever the role", () => {
    const administrator = { ...principal, role: "ADMINISTRATOR" as const };
    expect(() => requireSchoolAccess(administrator, "smk")).toThrow(ForbiddenError);
  });
});
