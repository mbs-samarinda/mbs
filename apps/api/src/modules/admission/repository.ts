import type { CycleStatus, DocumentType } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

type Executor = Database | Transaction;

/**
 * Reads the cycle a school is currently showing to the public.
 *
 * Only OPEN and CLOSED cycles qualify: a DRAFT is next year's cycle being
 * prepared and must not leak, and an ARCHIVED one is finished. Nothing stops a
 * school from having two qualifying cycles, so the newest registration window
 * wins rather than whichever row Postgres happens to return first.
 */
export async function findCurrentCycleForSchool(db: Database, schoolKey: string) {
  const rows = await db
    .select({
      id: schema.admissionCycles.id,
      name: schema.admissionCycles.name,
      status: schema.admissionCycles.status,
      registrationOpenAt: schema.admissionCycles.registrationOpenAt,
      registrationCloseAt: schema.admissionCycles.registrationCloseAt,
      resultPublishAt: schema.admissionCycles.resultPublishAt,
      defaultFee: schema.admissionCycles.defaultFee,
      feeOverride: schema.schoolAdmissionSettings.feeOverride,
      isEnabled: schema.schoolAdmissionSettings.isEnabled,
    })
    .from(schema.admissionCycles)
    .innerJoin(
      schema.schoolAdmissionSettings,
      eq(schema.schoolAdmissionSettings.admissionCycleId, schema.admissionCycles.id),
    )
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAdmissionSettings.schoolId))
    .where(
      and(
        eq(schema.schools.key, schoolKey),
        inArray(schema.admissionCycles.status, ["OPEN", "CLOSED"]),
      ),
    )
    .orderBy(desc(schema.admissionCycles.registrationOpenAt))
    .limit(1);

  return rows[0] ?? null;
}

export async function listCycles(db: Executor) {
  return db
    .select()
    .from(schema.admissionCycles)
    .orderBy(desc(schema.admissionCycles.registrationOpenAt));
}

export async function findCycleById(db: Executor, cycleId: string) {
  const rows = await db
    .select()
    .from(schema.admissionCycles)
    .where(eq(schema.admissionCycles.id, cycleId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Reads a cycle and holds the row until the caller's transaction ends. Status
 * and the archive guard are both read-then-write, so two administrators
 * archiving and editing at once have to take turns.
 */
export async function findCycleForUpdate(tx: Transaction, cycleId: string) {
  const rows = await tx
    .select()
    .from(schema.admissionCycles)
    .where(eq(schema.admissionCycles.id, cycleId))
    .for("update");

  return rows[0] ?? null;
}

export async function insertCycle(
  db: Executor,
  values: {
    name: string;
    registrationOpenAt: Date;
    registrationCloseAt: Date;
    resultPublishAt: Date;
    defaultFee: number;
  },
) {
  const rows = await db.insert(schema.admissionCycles).values(values).returning();
  return rows[0]!;
}

export async function updateCycleFields(
  db: Executor,
  cycleId: string,
  values: {
    name: string;
    registrationOpenAt: Date;
    registrationCloseAt: Date;
    resultPublishAt: Date;
    defaultFee: number;
  },
) {
  const rows = await db
    .update(schema.admissionCycles)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(schema.admissionCycles.id, cycleId))
    .returning();

  return rows[0]!;
}

export async function updateCycleStatus(db: Executor, cycleId: string, status: CycleStatus) {
  const rows = await db
    .update(schema.admissionCycles)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.admissionCycles.id, cycleId))
    .returning();

  return rows[0]!;
}

export async function findSchoolIdByKey(db: Executor, schoolKey: string) {
  const rows = await db
    .select({ id: schema.schools.id })
    .from(schema.schools)
    .where(eq(schema.schools.key, schoolKey))
    .limit(1);

  return rows[0]?.id ?? null;
}

/** Every school that has joined this cycle, keyed by the school key. */
export async function listSchoolSettings(db: Executor, cycleId: string) {
  return db
    .select({
      schoolKey: schema.schools.key,
      isEnabled: schema.schoolAdmissionSettings.isEnabled,
      feeOverride: schema.schoolAdmissionSettings.feeOverride,
      acceptedInstructions: schema.schoolAdmissionSettings.acceptedInstructions,
      rejectedInstructions: schema.schoolAdmissionSettings.rejectedInstructions,
    })
    .from(schema.schoolAdmissionSettings)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAdmissionSettings.schoolId))
    .where(eq(schema.schoolAdmissionSettings.admissionCycleId, cycleId));
}

export async function listDocumentRequirements(db: Executor, cycleId: string) {
  return db
    .select({
      schoolKey: schema.schools.key,
      type: schema.documentRequirements.type,
      required: schema.documentRequirements.required,
    })
    .from(schema.documentRequirements)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.documentRequirements.schoolId))
    .where(eq(schema.documentRequirements.admissionCycleId, cycleId))
    .orderBy(asc(schema.documentRequirements.type));
}

export async function upsertSchoolSetting(
  db: Executor,
  values: {
    admissionCycleId: string;
    schoolId: string;
    isEnabled: boolean;
    feeOverride: number | null;
    acceptedInstructions: string | null;
    rejectedInstructions: string | null;
  },
) {
  await db
    .insert(schema.schoolAdmissionSettings)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.schoolAdmissionSettings.admissionCycleId,
        schema.schoolAdmissionSettings.schoolId,
      ],
      set: {
        isEnabled: values.isEnabled,
        feeOverride: values.feeOverride,
        acceptedInstructions: values.acceptedInstructions,
        rejectedInstructions: values.rejectedInstructions,
      },
    });
}

/** Replaced wholesale: the client sends the school's complete document list. */
export async function replaceDocumentRequirements(
  db: Executor,
  cycleId: string,
  schoolId: string,
  documents: readonly { type: DocumentType; required: boolean }[],
) {
  await db
    .delete(schema.documentRequirements)
    .where(
      and(
        eq(schema.documentRequirements.admissionCycleId, cycleId),
        eq(schema.documentRequirements.schoolId, schoolId),
      ),
    );

  if (documents.length > 0) {
    await db.insert(schema.documentRequirements).values(
      documents.map((document) => ({
        admissionCycleId: cycleId,
        schoolId,
        type: document.type,
        required: document.required,
      })),
    );
  }
}
