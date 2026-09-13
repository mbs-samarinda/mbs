import { createDatabase, schema } from "@mbs/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { findCurrentCycleForSchool } from "./repository.ts";
import { getCurrentCycle } from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

const dates = {
  registrationOpenAt: new Date("2026-01-01T00:00:00Z"),
  registrationCloseAt: new Date("2026-03-01T00:00:00Z"),
  resultPublishAt: new Date("2026-04-01T00:00:00Z"),
};

async function joinSchoolToCycle(
  name: string,
  status: "DRAFT" | "OPEN" | "CLOSED" | "ARCHIVED",
  registrationOpenAt: Date,
) {
  const [school] = await db
    .insert(schema.schools)
    .values({ key: "sma" })
    .onConflictDoUpdate({ target: schema.schools.key, set: { key: "sma" } })
    .returning();

  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({ ...dates, registrationOpenAt, name, status, defaultFee: 500_000 })
    .returning();

  await db
    .insert(schema.schoolAdmissionSettings)
    .values({ admissionCycleId: cycle!.id, schoolId: school!.id, isEnabled: true });
}

beforeEach(async () => {
  // Not `schools`: its three rows are seeded by a migration and referenced by
  // staff access, so wiping them would break the next suite and the API's own
  // startup.
  await db.execute(
    sql`truncate ${schema.schoolAdmissionSettings}, ${schema.documentRequirements}, ${schema.admissionCycles} cascade`,
  );
});

afterAll(() => db.$client.end());

describe("findCurrentCycleForSchool", () => {
  it("hides a cycle the committee is still drafting", async () => {
    await joinSchoolToCycle("2027/2028", "DRAFT", dates.registrationOpenAt);
    expect(await findCurrentCycleForSchool(db, "sma")).toBeNull();
  });

  it("hides an archived cycle", async () => {
    await joinSchoolToCycle("2025/2026", "ARCHIVED", dates.registrationOpenAt);
    expect(await findCurrentCycleForSchool(db, "sma")).toBeNull();
  });

  it("prefers the newest registration window when two cycles qualify", async () => {
    await joinSchoolToCycle("2026/2027", "CLOSED", new Date("2025-01-01T00:00:00Z"));
    await joinSchoolToCycle("2027/2028", "OPEN", new Date("2026-01-01T00:00:00Z"));

    const cycle = await findCurrentCycleForSchool(db, "sma");
    expect(cycle?.name).toBe("2027/2028");
  });

  it("returns nothing for a school with no cycle", async () => {
    expect(await findCurrentCycleForSchool(db, "smp")).toBeNull();
  });
});

describe("getCurrentCycle", () => {
  // The public page prints these, so one school's list must never pick up
  // another school's rows: both schools join the same global cycle.
  it("carries only the asking school's document requirements", async () => {
    await joinSchoolToCycle("2027/2028", "OPEN", dates.registrationOpenAt);

    const [cycle] = await db.select().from(schema.admissionCycles);
    const schools = await db.select().from(schema.schools);
    const sma = schools.find((school) => school.key === "sma");
    const smk = schools.find((school) => school.key === "smk");

    await db.insert(schema.documentRequirements).values([
      { admissionCycleId: cycle!.id, schoolId: sma!.id, type: "KARTU_KELUARGA", required: true },
      { admissionCycleId: cycle!.id, schoolId: sma!.id, type: "IJAZAH", required: false },
      { admissionCycleId: cycle!.id, schoolId: smk!.id, type: "AKTA_KELAHIRAN", required: true },
    ]);

    const published = await getCurrentCycle(db, "sma");
    expect(published?.documents).toEqual([
      { type: "KARTU_KELUARGA", required: true },
      { type: "IJAZAH", required: false },
    ]);
  });
});
