import { createDatabase, schema } from "@mbs/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findCurrentCycleForSchool } from "./repository.ts";

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
    .values({ key: "sma", name: "SMA", level: "SMA" })
    .onConflictDoUpdate({ target: schema.schools.key, set: { name: "SMA" } })
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
  await db.execute(
    sql`truncate ${schema.schoolAdmissionSettings}, ${schema.admissionCycles}, ${schema.schools} cascade`,
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
