import type { SaveCycleInput } from "@mbs/api-contract";
import { createDatabase, schema } from "@mbs/db";
import { SCHOOL_KEYS } from "@mbs/school-config";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AnotherCycleOpenError,
  ConflictError,
  ForbiddenError,
  NotReadyError,
} from "../../errors.ts";
import { resetTables } from "../../test/reset.ts";
import { submitApplication } from "../application/service.ts";
import type { StaffContext } from "../auth/authorization.ts";
import {
  createAdmissionCycle,
  getCurrentCycle,
  getCycleSetup,
  listAdmissionCycles,
  listSchoolAgreementVersions,
  saveCycleSection,
  setAdmissionCycleStatus,
} from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

const actor: StaffContext = {
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "Siti Rahmah",
  role: "ADMINISTRATOR",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-actor",
};

/** Scoped to one school, to prove the boundary rather than assume it. */
const smaOnly: StaffContext = { ...actor, schoolKeys: ["sma"] };

const DAY = 86_400_000;
const cycleInput = {
  name: "PPDB 2027/2028",
  registrationOpenAt: new Date(Date.now() - DAY).toISOString(),
  registrationCloseAt: new Date(Date.now() + 30 * DAY).toISOString(),
  resultPublishAt: new Date(Date.now() + 60 * DAY).toISOString(),
  defaultFee: 250_000,
};

const bank = {
  bankName: "Bank Syariah Indonesia",
  accountNumber: "7123 4567 89",
  accountHolder: "Yayasan Madina Samarinda",
};

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
    schema.schoolAgreementVersions,
    schema.admissionCycles,
    schema.staffUsers,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
  // An agreement version names the staff member who saved it.
  await db.insert(schema.staffUsers).values({ id: actor.id, name: actor.name, role: actor.role });
});

afterAll(() => db.$client.end());

const save = (input: SaveCycleInput, who: StaffContext = actor) => saveCycleSection(db, who, input);

/** Fills exactly what opening needs, and nothing that can wait. */
async function makeReady(cycleId: string) {
  await save({ section: "bank", cycleId, bank });
  await save({
    section: "documents",
    cycleId,
    schools: SCHOOL_KEYS.map((schoolKey) => ({
      schoolKey,
      registration: [{ type: "KARTU_KELUARGA", required: true }],
      reregistration: [],
    })),
  });
}

async function readyCycle(name = cycleInput.name) {
  const cycle = await createAdmissionCycle(db, actor, { ...cycleInput, name });
  await makeReady(cycle.id);
  return cycle;
}

const auditRows = (cycleId: string) =>
  db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "admission_cycles"),
        eq(schema.auditLogs.entityId, cycleId),
      ),
    )
    .orderBy(asc(schema.auditLogs.createdAt));

describe("cycles", () => {
  it("creates a draft cycle and lists it", async () => {
    const created = await createAdmissionCycle(db, actor, cycleInput);

    expect(created).toMatchObject({ status: "DRAFT", defaultFee: 250_000, bank: null });
    expect(await listAdmissionCycles(db)).toEqual([created]);
  });

  it("moves one step forward and refuses to skip", async () => {
    const cycle = await readyCycle();

    await expect(
      setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "CLOSED" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const open = await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });
    expect(open.status).toBe("OPEN");
  });

  it("refuses to open without a bank account and registration documents", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    const refusal = setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });

    await expect(refusal).rejects.toBeInstanceOf(NotReadyError);
    await expect(refusal).rejects.toMatchObject({
      data: {
        gaps: [
          { kind: "bank", schoolKey: null },
          { kind: "registrationDocuments", schoolKey: "smp" },
          { kind: "registrationDocuments", schoolKey: "smk" },
          { kind: "registrationDocuments", schoolKey: "sma" },
        ],
      },
    });
  });

  // The school sets these after registration opens; applications copy them at publication.
  it("opens while the registrasi ulang parts are still missing, and lists them", async () => {
    const cycle = await readyCycle();

    const setup = await getCycleSetup(db, actor, { cycleId: cycle.id });
    expect(new Set(setup.gaps.map((gap) => gap.kind))).toEqual(
      new Set([
        "reregistrationFee",
        "reregistrationDocuments",
        "acceptedInstructions",
        "rejectedInstructions",
        "agreement",
      ]),
    );
    await expect(
      setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" }),
    ).resolves.toMatchObject({ status: "OPEN" });
  });

  it("asks nothing of a school that is not taking part", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    await save({ section: "bank", cycleId: cycle.id, bank });
    await save({
      section: "documents",
      cycleId: cycle.id,
      schools: (["smp", "smk"] as const).map((schoolKey) => ({
        schoolKey,
        registration: [{ type: "KARTU_KELUARGA", required: true }],
        reregistration: [],
      })),
    });
    await save({
      section: "schedule",
      cycleId: cycle.id,
      ...cycleInput,
      schools: [{ schoolKey: "sma", isEnabled: false }],
    });

    await expect(
      setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" }),
    ).resolves.toMatchObject({ status: "OPEN" });
  });

  // Checked before readiness: an incomplete second cycle should hear why it can never open now.
  it("explains that another cycle is open before listing what is missing", async () => {
    const first = await readyCycle();
    const second = await createAdmissionCycle(db, actor, { ...cycleInput, name: "PPDB 2028/2029" });
    await setAdmissionCycleStatus(db, actor, { cycleId: first.id, status: "OPEN" });

    await expect(
      setAdmissionCycleStatus(db, actor, { cycleId: second.id, status: "OPEN" }),
    ).rejects.toBeInstanceOf(AnotherCycleOpenError);
  });

  it("makes an archived cycle read-only", async () => {
    const cycle = await readyCycle();
    for (const status of ["OPEN", "CLOSED", "ARCHIVED"] as const) {
      await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status });
    }

    await expect(save({ section: "bank", cycleId: cycle.id, bank })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("still accepts changes while the cycle is closed", async () => {
    const cycle = await readyCycle();
    for (const status of ["OPEN", "CLOSED"] as const) {
      await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status });
    }

    const saved = await save({
      section: "fees",
      cycleId: cycle.id,
      defaultFee: 250_000,
      schools: [{ schoolKey: "sma", feeOverride: null, reregistrationFee: 3_500_000 }],
    });
    expect(saved.schools.find((school) => school.schoolKey === "sma")?.reregistrationFee).toBe(
      3_500_000,
    );
  });

  it("starts a new cycle from the newest one, with its own name and dates", async () => {
    const old = await readyCycle("PPDB 2026/2027");
    await save({
      section: "fees",
      cycleId: old.id,
      defaultFee: 250_000,
      schools: [{ schoolKey: "sma", feeOverride: 300_000, reregistrationFee: 4_000_000 }],
    });
    await save({
      section: "messages",
      cycleId: old.id,
      schools: [{ schoolKey: "sma", acceptedInstructions: "Selamat.", rejectedInstructions: null }],
    });
    const later = new Date(Date.parse(cycleInput.registrationOpenAt) + 365 * DAY).toISOString();

    const next = await createAdmissionCycle(db, actor, {
      ...cycleInput,
      name: "PPDB 2027/2028",
      registrationOpenAt: later,
      registrationCloseAt: new Date(Date.parse(later) + 30 * DAY).toISOString(),
      resultPublishAt: new Date(Date.parse(later) + 60 * DAY).toISOString(),
    });
    const setup = await getCycleSetup(db, actor, { cycleId: next.id });

    expect(setup.cycle).toMatchObject({ name: "PPDB 2027/2028", status: "DRAFT", bank });
    expect(setup.schools.find((school) => school.schoolKey === "sma")).toMatchObject({
      effectiveFee: 300_000,
      reregistrationFee: 4_000_000,
      acceptedInstructions: "Selamat.",
      registrationDocuments: [{ type: "KARTU_KELUARGA", required: true }],
    });
    expect(setup.history).toMatchObject([{ created: true, who: "Siti Rahmah", changes: [] }]);
  });
});

describe("cycle sections", () => {
  it("sets the registrasi ulang fee per school beside the registration fee", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    const setup = await save({
      section: "fees",
      cycleId: cycle.id,
      defaultFee: 250_000,
      schools: [
        { schoolKey: "smp", feeOverride: null, reregistrationFee: 3_500_000 },
        { schoolKey: "sma", feeOverride: 300_000, reregistrationFee: null },
      ],
    });

    expect(
      setup.schools.map(({ schoolKey, effectiveFee, reregistrationFee }) => ({
        schoolKey,
        effectiveFee,
        reregistrationFee,
      })),
    ).toEqual([
      { schoolKey: "smp", effectiveFee: 250_000, reregistrationFee: 3_500_000 },
      { schoolKey: "smk", effectiveFee: 250_000, reregistrationFee: null },
      { schoolKey: "sma", effectiveFee: 300_000, reregistrationFee: null },
    ]);
  });

  it("keeps each stage's documents apart, and shows the public only registration's", async () => {
    const cycle = await readyCycle();
    await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });

    const setup = await save({
      section: "documents",
      cycleId: cycle.id,
      schools: [
        {
          schoolKey: "sma",
          registration: [{ type: "KARTU_KELUARGA", required: true }],
          reregistration: [{ type: "IJAZAH", required: true }],
        },
      ],
    });

    expect(setup.schools.find((school) => school.schoolKey === "sma")).toMatchObject({
      registrationDocuments: [{ type: "KARTU_KELUARGA", required: true }],
      reregistrationDocuments: [{ type: "IJAZAH", required: true }],
    });
    expect((await getCurrentCycle(db, "sma"))?.documents).toEqual([
      { type: "KARTU_KELUARGA", required: true },
    ]);
  });

  it("versions the agreement and keeps it with the school for the next cycle", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    const agreement = (body: string) =>
      save({ section: "agreement", cycleId: cycle.id, schools: [{ schoolKey: "smk", body }] });

    await agreement("Versi pertama.");
    await agreement("Versi kedua.");
    const repeated = await agreement("Versi kedua.");

    const smk = repeated.schools.find((school) => school.schoolKey === "smk");
    expect(smk?.agreement).toMatchObject({
      version: 2,
      body: "Versi kedua.",
      createdBy: "Siti Rahmah",
    });
    expect(smk?.agreementVersions).toBe(2);
    expect(
      (await listSchoolAgreementVersions(db, actor, { schoolKey: "smk" })).map(
        ({ version, body }) => ({ version, body }),
      ),
    ).toEqual([
      { version: 2, body: "Versi kedua." },
      { version: 1, body: "Versi pertama." },
    ]);

    const next = await createAdmissionCycle(db, actor, { ...cycleInput, name: "PPDB 2028/2029" });
    const carried = await getCycleSetup(db, actor, { cycleId: next.id });
    expect(carried.schools.find((school) => school.schoolKey === "smk")?.agreement?.id).toBe(
      smk?.agreement?.id,
    );
  });

  it("refuses to change an agreement version in place", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    await save({
      section: "agreement",
      cycleId: cycle.id,
      schools: [{ schoolKey: "smk", body: "A" }],
    });

    await expect(
      db.update(schema.schoolAgreementVersions).set({ body: "B" }),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(/school_agreement_versions: history rows are append-only/),
      },
    });
  });

  it("files one audit row per save under the cycle, with only the changed fields", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);
    const fees = {
      section: "fees",
      cycleId: cycle.id,
      defaultFee: 250_000,
      schools: SCHOOL_KEYS.map((schoolKey) => ({
        schoolKey,
        feeOverride: schoolKey === "sma" ? 300_000 : null,
        reregistrationFee: null,
      })),
    } as const;

    await save(fees);
    await save(fees);
    await save({
      section: "schedule",
      cycleId: cycle.id,
      ...cycleInput,
      registrationCloseAt: new Date(Date.parse(cycleInput.registrationCloseAt) + DAY).toISOString(),
      schools: [],
    });

    const rows = await auditRows(cycle.id);
    expect(rows.map((row) => row.action)).toEqual(["cycle.create", "cycle.fees", "cycle.schedule"]);
    expect(rows[1]?.metadata).toEqual({
      changes: [{ field: "fee", schoolKey: "sma", from: null, to: 300_000 }],
    });
    expect(rows[2]?.metadata).toEqual({
      changes: [
        {
          field: "registrationCloseAt",
          schoolKey: null,
          from: cycleInput.registrationCloseAt,
          to: new Date(Date.parse(cycleInput.registrationCloseAt) + DAY).toISOString(),
        },
      ],
    });
    const { history } = await getCycleSetup(db, actor, { cycleId: cycle.id });
    expect(history.map((change) => change.changes.map((each) => each.field))).toEqual([
      ["registrationCloseAt"],
      ["fee"],
      [],
    ]);
  });

  it("records the agreement by version and the status by name", async () => {
    const cycle = await readyCycle();
    await save({
      section: "agreement",
      cycleId: cycle.id,
      schools: [{ schoolKey: "smp", body: "A" }],
    });
    await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });

    const { history } = await getCycleSetup(db, actor, { cycleId: cycle.id });
    expect(history.slice(0, 2).map((change) => change.changes)).toEqual([
      [{ field: "status", schoolKey: null, from: "DRAFT", to: "OPEN" }],
      [{ field: "agreement", schoolKey: "smp", from: null, to: 1 }],
    ]);
  });

  it("shows an administrator only their schools but every school's gaps", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    const setup = await getCycleSetup(db, smaOnly, { cycleId: cycle.id });

    expect(setup.schools.map((school) => school.schoolKey)).toEqual(["sma"]);
    expect(setup.gaps.some((gap) => gap.schoolKey === "smp")).toBe(true);
  });

  it("refuses a school the administrator does not hold", async () => {
    const cycle = await createAdmissionCycle(db, actor, cycleInput);

    await expect(
      save(
        {
          section: "messages",
          cycleId: cycle.id,
          schools: [{ schoolKey: "smp", acceptedInstructions: "Halo", rejectedInstructions: null }],
        },
        smaOnly,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("fees and the public page", () => {
  it("shows a new fee at once and keeps the fee an application was created with", async () => {
    const cycle = await readyCycle();
    await setAdmissionCycleStatus(db, actor, { cycleId: cycle.id, status: "OPEN" });
    await db
      .insert(schema.user)
      .values({
        id: "family-1",
        name: "family-1",
        email: "family-1@example.test",
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
    const { application } = await submitApplication(
      db,
      {
        cycleId: cycle.id,
        schoolKey: "sma",
        userId: "family-1",
        idempotencyKey: crypto.randomUUID(),
        profile: {
          childFullName: "Aisyah Putri",
          nik: "6472010101010001",
          birthDate: "2014-05-01",
          sex: "FEMALE",
          schoolOfOrigin: "SD Negeri 1 Samarinda",
          guardianName: "Budi",
          guardianRelation: "FATHER",
          guardianPhone: "081234567890",
        },
      },
      { familyAppUrl: "http://localhost:5173" },
    );

    await save({
      section: "fees",
      cycleId: cycle.id,
      defaultFee: 250_000,
      schools: [{ schoolKey: "sma", feeOverride: 350_000, reregistrationFee: null }],
    });

    expect((await getCurrentCycle(db, "sma"))?.effectiveFee).toBe(350_000);
    const [kept] = await db
      .select({ fee: schema.applications.registrationFee })
      .from(schema.applications)
      .where(eq(schema.applications.id, application.id));
    expect(kept?.fee).toBe(250_000);
  });
});
