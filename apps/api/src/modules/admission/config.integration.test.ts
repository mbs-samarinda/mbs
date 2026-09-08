import { createDatabase, schema } from "@mbs/db";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "../../errors.ts";
import type { StaffContext } from "../auth/authorization.ts";
import {
  createAdmissionCycle,
  listAdmissionCycles,
  listSchoolAdmissionSettings,
  setAdmissionCycleStatus,
  updateAdmissionCycle,
  upsertSchoolAdmissionSetting,
} from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

const actor: StaffContext = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "Test actor",
  role: "ADMINISTRATOR",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-actor",
};

/** Scoped to one school, to prove the boundary rather than assume it. */
const smaOnly: StaffContext = { ...actor, schoolKeys: ["sma"] };

const cycleInput = {
  name: "2027/2028",
  registrationOpenAt: "2026-11-01T00:00:00.000Z",
  registrationCloseAt: "2026-12-31T00:00:00.000Z",
  resultPublishAt: "2027-01-15T00:00:00.000Z",
  defaultFee: 250_000,
};

beforeEach(async () => {
  await db.execute(
    sql`truncate ${schema.auditLogs}, ${schema.documentRequirements}, ${schema.schoolAdmissionSettings}, ${schema.admissionCycles} cascade`,
  );
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
});

afterAll(() => db.$client.end());

describe("cycles", () => {
  it("creates a draft cycle and lists it", async () => {
    const created = await createAdmissionCycle(db, actor, cycleInput);

    expect(created.status).toBe("DRAFT");
    expect(created.defaultFee).toBe(250_000);
    expect(await listAdmissionCycles(db)).toEqual([created]);
  });

  it("moves one step forward and refuses to skip", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    await expect(
      setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "CLOSED" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const open = await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });
    expect(open.status).toBe("OPEN");
  });

  it("makes an archived cycle read-only", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    for (const status of ["OPEN", "CLOSED", "ARCHIVED"] as const) {
      await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status });
    }

    await expect(
      updateAdmissionCycle(db, actor, { ...cycleInput, cycleId: cycle.id, name: "Renamed" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      upsertSchoolAdmissionSetting(db, actor, {
        cycleId: cycle.id,
        schoolKey: "sma",
        isEnabled: true,
        feeOverride: null,
        acceptedInstructions: null,
        rejectedInstructions: null,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("records who changed the status", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });

    const entries = await db
      .select()
      .from(schema.auditLogs)
      .orderBy(asc(schema.auditLogs.createdAt));
    expect(entries.map((entry) => entry.action)).toEqual(["cycle.create", "cycle.setStatus"]);
    expect(entries[1]?.metadata).toEqual({ from: "DRAFT", to: "OPEN" });
  });
});

describe("school settings", () => {
  it("shows every school in scope, joined or not", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    const settings = await listSchoolAdmissionSettings(db, smaOnly, { cycleId: cycle.id });
    expect(settings).toEqual([
      {
        schoolKey: "sma",
        isEnabled: false,
        feeOverride: null,
        effectiveFee: 250_000,
        acceptedInstructions: null,
        rejectedInstructions: null,
        documents: [],
      },
    ]);
  });

  it("saves settings and documents together, replacing the previous list", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    const saved = await upsertSchoolAdmissionSetting(db, actor, {
      cycleId: cycle.id,
      schoolKey: "sma",
      isEnabled: true,
      feeOverride: 100_000,
      acceptedInstructions: "Daftar ulang paling lambat 20 Januari.",
      rejectedInstructions: null,
      documents: [
        { type: "KARTU_KELUARGA", required: true },
        { type: "IJAZAH", required: false },
      ],
    });

    expect(saved.effectiveFee).toBe(100_000);
    expect(saved.documents).toHaveLength(2);

    const rewritten = await upsertSchoolAdmissionSetting(db, actor, {
      cycleId: cycle.id,
      schoolKey: "sma",
      isEnabled: true,
      feeOverride: null,
      acceptedInstructions: null,
      rejectedInstructions: null,
      documents: [{ type: "AKTA_KELAHIRAN", required: true }],
    });

    expect(rewritten.feeOverride).toBeNull();
    expect(rewritten.effectiveFee).toBe(250_000);
    expect(rewritten.documents).toEqual([{ type: "AKTA_KELAHIRAN", required: true }]);
  });

  it("still accepts changes while the cycle is closed", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    for (const status of ["OPEN", "CLOSED"] as const) {
      await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status });
    }

    const saved = await upsertSchoolAdmissionSetting(db, actor, {
      cycleId: cycle.id,
      schoolKey: "sma",
      isEnabled: true,
      feeOverride: null,
      acceptedInstructions: null,
      rejectedInstructions: null,
      documents: [],
    });

    expect(saved.isEnabled).toBe(true);
  });

  it("refuses a school the administrator does not hold", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    await expect(
      upsertSchoolAdmissionSetting(db, smaOnly, {
        cycleId: cycle.id,
        schoolKey: "smp",
        isEnabled: true,
        feeOverride: null,
        acceptedInstructions: null,
        rejectedInstructions: null,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
