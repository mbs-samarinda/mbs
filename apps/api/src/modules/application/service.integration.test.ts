import type { ApplicantProfileInput, SchoolKey } from "@mbs/api-contract";
import { createDatabase, schema } from "@mbs/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  DuplicateApplicationError,
  ForbiddenError,
  IllegalTransitionError,
  NotFoundError,
  RegistrationClosedError,
  StaleSequenceError,
} from "../../errors.ts";
import { resetTables } from "../../test/reset.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { applyCommand, saveProfile, submitApplication, type Actor } from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

afterAll(() => db.$client.end());

const DAY = 86_400_000;

const staff: StaffContext = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "Panitia",
  role: "STAFF",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-staff",
};
const STAFF: Actor = { type: "STAFF", staff };
const FAMILY: Actor = { type: "FAMILY", userId: "family-1" };

function profile(overrides: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput {
  return {
    childFullName: "Aisyah Putri",
    nik: "6472 0101 0101 0001",
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi",
    guardianRelation: "Ayah",
    guardianPhone: "081234567890",
    ...overrides,
  };
}

let cycleId: string;

beforeEach(async () => {
  await resetTables(db, [
    schema.auditLogs,
    schema.applicationEvents,
    schema.applicantProfileVersions,
    schema.applicationDocumentRequirements,
    schema.applicationAccess,
    schema.applications,
    schema.documentRequirements,
    schema.schoolAdmissionSettings,
    schema.admissionCycles,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
  await db.insert(schema.user).values(
    ["family-1", "family-2"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      updatedAt: new Date(),
    })),
  );
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name: "2027/2028",
      registrationOpenAt: new Date(Date.now() - DAY),
      registrationCloseAt: new Date(Date.now() + 30 * DAY),
      resultPublishAt: new Date(Date.now() + 60 * DAY),
      defaultFee: 250_000,
      status: "OPEN",
    })
    .returning();
  cycleId = cycle!.id;
});

function submit(
  options: {
    schoolKey?: SchoolKey;
    userId?: string;
    key?: string | null;
    profile?: ApplicantProfileInput;
  } = {},
) {
  return submitApplication(db, {
    cycleId,
    schoolKey: options.schoolKey ?? "smp",
    userId: options.userId ?? "family-1",
    profile: options.profile ?? profile(),
    idempotencyKey: options.key === undefined ? crypto.randomUUID() : options.key,
  });
}

async function eventsOf(applicationId: string) {
  return db
    .select()
    .from(schema.applicationEvents)
    .where(eq(schema.applicationEvents.applicationId, applicationId))
    .orderBy(asc(schema.applicationEvents.seq));
}

describe("submitApplication", () => {
  it("opens the application with everything it starts with", async () => {
    const [smp] = await db.select().from(schema.schools).where(eq(schema.schools.key, "smp"));
    await db.insert(schema.documentRequirements).values([
      { admissionCycleId: cycleId, schoolId: smp!.id, type: "KARTU_KELUARGA", required: true },
      {
        admissionCycleId: cycleId,
        schoolId: smp!.id,
        type: "IJAZAH",
        required: true,
        stage: "REREGISTRATION",
      },
    ]);

    const { application, event } = await submit();

    expect(application).toMatchObject({
      registrationNumber: "SMP-0001",
      stage: "PAYMENT_DUE",
      nik: "6472010101010001",
      registrationFee: 250_000,
      lastEventSeq: 1,
    });
    expect(event).toMatchObject({
      seq: 1,
      command: "SUBMIT",
      fromStage: null,
      toStage: "PAYMENT_DUE",
      familyVisible: true,
    });

    const versions = await db.select().from(schema.applicantProfileVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, authorUserId: "family-1" });

    const access = await db.select().from(schema.applicationAccess);
    expect(access).toMatchObject([{ applicationId: application.id, userId: "family-1" }]);

    const promised = await db.select().from(schema.applicationDocumentRequirements);
    expect(promised.map(({ stage, type }) => `${stage}:${type}`).toSorted()).toEqual([
      "APPLICATION:KARTU_KELUARGA",
      "REREGISTRATION:IJAZAH",
    ]);
  });

  it("keeps the fee it was charged when the cycle's fee changes", async () => {
    const { application } = await submit();
    await db.update(schema.admissionCycles).set({ defaultFee: 999_000 });

    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, application.id));
    expect(row!.registrationFee).toBe(250_000);
  });

  it("numbers registrations in order, separately for each school", async () => {
    const numbers = [];
    for (const [schoolKey, n] of [
      ["smp", 1],
      ["smp", 2],
      ["sma", 3],
      ["smp", 4],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const { application } = await submit({
        schoolKey,
        profile: profile({ nik: `647201010101000${n}` }),
      });
      numbers.push(application.registrationNumber);
    }

    expect(numbers).toEqual(["SMP-0001", "SMP-0002", "SMA-0001", "SMP-0003"]);
  });

  it("hands out distinct numbers to submissions that arrive together", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => submit({ profile: profile({ nik: `647201010101000${n}` }) })),
    );

    expect(results.map((result) => result.application.registrationNumber).toSorted()).toEqual([
      "SMP-0001",
      "SMP-0002",
      "SMP-0003",
      "SMP-0004",
      "SMP-0005",
    ]);
  });

  it("refuses the same child twice at one school, without naming the first application", async () => {
    const first = await submit();

    const second = submit({ userId: "family-2", profile: profile({ nik: "6472.0101.0101.0001" }) });

    await expect(second).rejects.toBeInstanceOf(DuplicateApplicationError);
    const message = await second.catch((error: Error) => error.message);
    expect(message).not.toContain(first.application.registrationNumber);
    expect(message).not.toContain("Aisyah");
    expect(await db.$count(schema.applications)).toBe(1);
  });

  it("lets the same child apply to two schools", async () => {
    const smp = await submit({ schoolKey: "smp" });
    const sma = await submit({ schoolKey: "sma" });

    expect(smp.application.registrationNumber).toBe("SMP-0001");
    expect(sma.application.registrationNumber).toBe("SMA-0001");
  });

  it("applies a retried submission once", async () => {
    const first = await submit({ key: "device-key-1" });
    const retry = await submit({ key: "device-key-1" });

    expect(retry.replayed).toBe(true);
    expect(retry.application.id).toBe(first.application.id);
    expect(await db.$count(schema.applications)).toBe(1);
    expect(await db.$count(schema.applicationEvents)).toBe(1);
  });

  it("refuses when the cycle is not open, the window has passed, or the school sits out", async () => {
    await expect(
      submitApplication(db, {
        cycleId,
        schoolKey: "smp",
        userId: "family-1",
        profile: profile(),
        idempotencyKey: null,
        now: new Date(Date.now() + 31 * DAY),
      }),
    ).rejects.toBeInstanceOf(RegistrationClosedError);

    const [smk] = await db.select().from(schema.schools).where(eq(schema.schools.key, "smk"));
    await db
      .insert(schema.schoolAdmissionSettings)
      .values({ admissionCycleId: cycleId, schoolId: smk!.id, isEnabled: false });
    await expect(submit({ schoolKey: "smk" })).rejects.toBeInstanceOf(RegistrationClosedError);

    await db.update(schema.admissionCycles).set({ status: "CLOSED" });
    await expect(submit()).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(await db.$count(schema.applications)).toBe(0);
  });
});

describe("applyCommand", () => {
  async function atPaymentReview() {
    const { application } = await submit();
    await applyCommand(db, {
      applicationId: application.id,
      actor: FAMILY,
      command: "UPLOAD_PAYMENT_PROOF",
      payload: { payloadVersion: 1 },
      expectedSeq: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    return application.id;
  }

  function approve(applicationId: string, key: string | null, expectedSeq = 2) {
    return applyCommand(db, {
      applicationId,
      actor: STAFF,
      command: "APPROVE_PAYMENT",
      payload: { payloadVersion: 1 },
      expectedSeq,
      idempotencyKey: key,
    });
  }

  it("moves the application and appends the next event", async () => {
    const applicationId = await atPaymentReview();
    const { event } = await approve(applicationId, "approve-1");

    expect(event).toMatchObject({
      seq: 3,
      command: "APPROVE_PAYMENT",
      fromStage: "PAYMENT_REVIEW",
      toStage: "DOCUMENTS_DUE",
      actorType: "STAFF",
      actorId: staff.id,
    });
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, applicationId));
    expect(row).toMatchObject({ stage: "DOCUMENTS_DUE", lastEventSeq: 3 });
  });

  it("applies a replayed idempotency key once and returns the first result", async () => {
    const applicationId = await atPaymentReview();

    const first = await approve(applicationId, "approve-1");
    // The retry still carries the seq the first attempt saw.
    const retry = await approve(applicationId, "approve-1");

    expect(retry.replayed).toBe(true);
    expect(retry.event.id).toBe(first.event.id);
    expect((await eventsOf(applicationId)).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("refuses a key reused for a different command", async () => {
    const applicationId = await atPaymentReview();
    await approve(applicationId, "staff-key");

    await expect(
      applyCommand(db, {
        applicationId,
        actor: STAFF,
        command: "ADD_NOTE",
        payload: { payloadVersion: 1, note: "Lunas." },
        expectedSeq: 3,
        idempotencyKey: "staff-key",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns a conflict for a command made against an older view", async () => {
    const applicationId = await atPaymentReview();

    await expect(approve(applicationId, "approve-1", 1)).rejects.toBeInstanceOf(StaleSequenceError);
    expect(await eventsOf(applicationId)).toHaveLength(2);
  });

  it("writes one event when two staff approve at the same moment", async () => {
    const applicationId = await atPaymentReview();

    const results = await Promise.allSettled([
      approve(applicationId, "approve-a"),
      approve(applicationId, "approve-b"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(StaleSequenceError);
    expect((await eventsOf(applicationId)).map((event) => event.command)).toEqual([
      "SUBMIT",
      "UPLOAD_PAYMENT_PROOF",
      "APPROVE_PAYMENT",
    ]);
  });

  it("refuses a command the stage table does not allow, and writes nothing", async () => {
    const { application } = await submit();

    await expect(
      applyCommand(db, {
        applicationId: application.id,
        actor: STAFF,
        command: "DECIDE",
        payload: { payloadVersion: 1, decision: "ACCEPTED" },
        expectedSeq: 1,
        idempotencyKey: null,
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await eventsOf(application.id)).toHaveLength(1);
  });

  it("refuses a rejection without a reason", async () => {
    const applicationId = await atPaymentReview();

    await expect(
      applyCommand(db, {
        applicationId,
        actor: STAFF,
        command: "REJECT_PAYMENT",
        payload: { payloadVersion: 1, reason: "   " },
        expectedSeq: 2,
        idempotencyKey: null,
      }),
    ).rejects.toThrow();
    expect(await eventsOf(applicationId)).toHaveLength(2);
  });

  it("hides an application from a family without access and staff outside its school", async () => {
    const { application } = await submit({ schoolKey: "sma" });
    const base = {
      applicationId: application.id,
      command: "WITHDRAW",
      payload: { payloadVersion: 1 },
      expectedSeq: 1,
      idempotencyKey: null,
    } as const;

    await expect(
      applyCommand(db, { ...base, actor: { type: "FAMILY", userId: "family-2" } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      applyCommand(db, {
        ...base,
        actor: { type: "STAFF", staff: { ...staff, schoolKeys: ["smp"] } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a principal change nothing, and a family run no staff command", async () => {
    const applicationId = await atPaymentReview();

    await expect(
      applyCommand(db, {
        applicationId,
        actor: { type: "STAFF", staff: { ...staff, role: "PRINCIPAL" } },
        command: "ADD_NOTE",
        payload: { payloadVersion: 1, note: "Catatan." },
        expectedSeq: 2,
        idempotencyKey: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      applyCommand(db, {
        applicationId,
        actor: FAMILY,
        command: "APPROVE_PAYMENT",
        payload: { payloadVersion: 1 },
        expectedSeq: 2,
        idempotencyKey: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records an interview mode change without moving the stage clock", async () => {
    const applicationId = await atPaymentReview();
    await approve(applicationId, null);
    const [before] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, applicationId));

    await applyCommand(db, {
      applicationId,
      actor: FAMILY,
      command: "CHANGE_INTERVIEW_MODE",
      payload: { payloadVersion: 1, mode: "ONLINE" },
      expectedSeq: 3,
      idempotencyKey: null,
    });

    const [after] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, applicationId));
    expect(after).toMatchObject({
      stage: "DOCUMENTS_DUE",
      interviewMode: "ONLINE",
      lastEventSeq: 4,
    });
    expect(after!.stageChangedAt).toEqual(before!.stageChangedAt);
  });

  it("cannot be edited afterwards: the database refuses to change an event", async () => {
    const { application } = await submit();

    for (const statement of [
      sql`update application_events set to_stage = 'ENROLLED'`,
      sql`delete from application_events`,
      sql`truncate application_events cascade`,
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await expect(db.execute(statement)).rejects.toMatchObject({
        cause: {
          message: expect.stringMatching(/application_events: history rows are append-only/),
        },
      });
    }
    expect(await eventsOf(application.id)).toHaveLength(1);
  });
});

describe("saveProfile", () => {
  it("appends a version for every save, and the newest NIK becomes the application's", async () => {
    const { application } = await submit();

    for (const [expectedVersion, name] of [
      [1, "Aisyah P."],
      [2, "Aisyah Putri Ramadhani"],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await saveProfile(db, {
        applicationId: application.id,
        userId: "family-1",
        profile: profile({ childFullName: name }),
        expectedVersion,
      });
    }
    const { version } = await saveProfile(db, {
      applicationId: application.id,
      userId: "family-1",
      profile: profile({ childFullName: "Aisyah Putri Ramadhani", nik: "6472010101019999" }),
      expectedVersion: 3,
    });

    expect(version).toBe(4);
    const versions = await db
      .select()
      .from(schema.applicantProfileVersions)
      .orderBy(asc(schema.applicantProfileVersions.version));
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4]);
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, application.id));
    expect(row!.nik).toBe("6472010101019999");
  });

  it("returns the saved version to a retry, and a conflict to an older view", async () => {
    const { application } = await submit();
    const edit = {
      applicationId: application.id,
      userId: "family-1",
      profile: profile({ childFullName: "Aisyah P." }),
      expectedVersion: 1,
    };

    const first = await saveProfile(db, edit);
    const retry = await saveProfile(db, edit);

    expect(retry).toEqual({ version: first.version, replayed: true });
    await expect(
      saveProfile(db, { ...edit, profile: profile({ childFullName: "Lain" }) }),
    ).rejects.toBeInstanceOf(StaleSequenceError);
    expect(await db.$count(schema.applicantProfileVersions)).toBe(2);
  });

  it("refuses a NIK that already applied to the same school", async () => {
    await submit({ profile: profile({ nik: "6472010101010001" }) });
    const { application } = await submit({ profile: profile({ nik: "6472010101010002" }) });

    await expect(
      saveProfile(db, {
        applicationId: application.id,
        userId: "family-1",
        profile: profile({ nik: "6472010101010001" }),
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(DuplicateApplicationError);
    expect(await db.$count(schema.applicantProfileVersions)).toBe(2);
  });
});
