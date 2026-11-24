import type { CycleStatus, DocumentStage, DocumentType } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

type Executor = Database | Transaction;

export const takesPart = sql<boolean>`coalesce(${schema.schoolAdmissionSettings.isEnabled}, true)`;

/**
 * Reads the cycle a school is currently showing to the public.
 *
 * Only OPEN and CLOSED cycles qualify: a DRAFT is next year's cycle being
 * prepared and must not leak, and an ARCHIVED one is finished. Nothing stops a
 * school from having two qualifying cycles, so the newest registration window
 * wins rather than whichever row Postgres happens to return first.
 *
 * Which cycle that is does not depend on the settings row. The school joins the
 * cycle on nothing — every school is in every cycle — and its settings row only
 * overrides the fee and the enabled flag, so the three schools cannot land on
 * different cycles. A school with no row is enabled at the cycle's default fee.
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
      isEnabled: takesPart,
    })
    .from(schema.admissionCycles)
    // No condition: this pairs the cycle with the school rather than filtering
    // it, which is what implicit membership looks like in SQL.
    .innerJoin(schema.schools, eq(schema.schools.key, schoolKey))
    .leftJoin(
      schema.schoolAdmissionSettings,
      and(
        eq(schema.schoolAdmissionSettings.admissionCycleId, schema.admissionCycles.id),
        eq(schema.schoolAdmissionSettings.schoolId, schema.schools.id),
      ),
    )
    .where(inArray(schema.admissionCycles.status, ["OPEN", "CLOSED"]))
    // The id breaks a tie on the open date. Without it two cycles opening the
    // same day leave the order undefined, and the umbrella asks three times —
    // three calls free to pick different rows is the disagreement this whole
    // change exists to remove.
    .orderBy(desc(schema.admissionCycles.registrationOpenAt), desc(schema.admissionCycles.id))
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

type CycleValues = Partial<
  Pick<
    typeof schema.admissionCycles.$inferInsert,
    | "name"
    | "registrationOpenAt"
    | "registrationCloseAt"
    | "resultPublishAt"
    | "defaultFee"
    | "bankName"
    | "bankAccountNumber"
    | "bankAccountHolder"
  >
>;

export async function insertCycle(
  db: Executor,
  values: CycleValues &
    Pick<
      typeof schema.admissionCycles.$inferInsert,
      "name" | "registrationOpenAt" | "registrationCloseAt" | "resultPublishAt" | "defaultFee"
    >,
) {
  const rows = await db.insert(schema.admissionCycles).values(values).returning();
  return rows[0]!;
}

export async function updateCycleFields(db: Executor, cycleId: string, values: CycleValues) {
  await db
    .update(schema.admissionCycles)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(schema.admissionCycles.id, cycleId));
}

/** Another open cycle, checked before the unique index so the refusal can say why. */
export async function findOpenCycleOtherThan(db: Executor, cycleId: string) {
  const rows = await db
    .select({ id: schema.admissionCycles.id })
    .from(schema.admissionCycles)
    .where(and(eq(schema.admissionCycles.status, "OPEN"), ne(schema.admissionCycles.id, cycleId)))
    .limit(1);
  return rows[0] ?? null;
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

/**
 * Every school that has overrides in this cycle, keyed by the school key. A
 * school missing from the result takes part at the cycle's defaults; it is not
 * a school left out.
 */
export async function listSchoolKeysTakingPart(db: Executor, cycleId: string) {
  const rows = await db
    .select({ key: schema.schools.key })
    .from(schema.schools)
    .leftJoin(
      schema.schoolAdmissionSettings,
      and(
        eq(schema.schoolAdmissionSettings.admissionCycleId, cycleId),
        eq(schema.schoolAdmissionSettings.schoolId, schema.schools.id),
      ),
    )
    .where(takesPart);
  return rows.map((row) => row.key);
}

export async function listSchools(db: Executor) {
  return db.select({ id: schema.schools.id, key: schema.schools.key }).from(schema.schools);
}

export async function listSchoolSettings(db: Executor, cycleId: string) {
  return db
    .select({
      schoolKey: schema.schools.key,
      isEnabled: schema.schoolAdmissionSettings.isEnabled,
      feeOverride: schema.schoolAdmissionSettings.feeOverride,
      reregistrationFee: schema.schoolAdmissionSettings.reregistrationFee,
      acceptedInstructions: schema.schoolAdmissionSettings.acceptedInstructions,
      rejectedInstructions: schema.schoolAdmissionSettings.rejectedInstructions,
    })
    .from(schema.schoolAdmissionSettings)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAdmissionSettings.schoolId))
    .where(eq(schema.schoolAdmissionSettings.admissionCycleId, cycleId));
}

export async function listDocumentRequirements(
  db: Executor,
  cycleId: string,
  stage?: DocumentStage,
) {
  return db
    .select({
      schoolKey: schema.schools.key,
      stage: schema.documentRequirements.stage,
      type: schema.documentRequirements.type,
      required: schema.documentRequirements.required,
    })
    .from(schema.documentRequirements)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.documentRequirements.schoolId))
    .where(
      and(
        eq(schema.documentRequirements.admissionCycleId, cycleId),
        stage ? eq(schema.documentRequirements.stage, stage) : undefined,
      ),
    )
    .orderBy(asc(schema.documentRequirements.type));
}

type SchoolSettingValues = Partial<
  Pick<
    typeof schema.schoolAdmissionSettings.$inferInsert,
    | "isEnabled"
    | "feeOverride"
    | "reregistrationFee"
    | "acceptedInstructions"
    | "rejectedInstructions"
  >
>;

/** Writes only the given columns. A school without a row gets one, defaults elsewhere. */
export async function upsertSchoolSetting(
  db: Executor,
  cycleId: string,
  schoolId: string,
  values: SchoolSettingValues,
) {
  await db
    .insert(schema.schoolAdmissionSettings)
    .values({ admissionCycleId: cycleId, schoolId, ...values })
    .onConflictDoUpdate({
      target: [
        schema.schoolAdmissionSettings.admissionCycleId,
        schema.schoolAdmissionSettings.schoolId,
      ],
      set: values,
    });
}

/** Copies one cycle's school settings and requirements into another, in two statements. */
export async function copySchoolSetup(db: Executor, fromCycleId: string, toCycleId: string) {
  await db.execute(sql`
    insert into school_admission_settings
      (admission_cycle_id, school_id, fee_override, reregistration_fee, is_enabled,
       accepted_instructions, rejected_instructions)
    select ${toCycleId}, school_id, fee_override, reregistration_fee, is_enabled,
       accepted_instructions, rejected_instructions
    from school_admission_settings where admission_cycle_id = ${fromCycleId}
  `);
  await db.execute(sql`
    insert into document_requirements (admission_cycle_id, school_id, document_type, required, stage)
    select ${toCycleId}, school_id, document_type, required, stage
    from document_requirements where admission_cycle_id = ${fromCycleId}
  `);
}

/** Each school's newest agreement and how many versions it has. */
export async function listNewestAgreements(db: Executor) {
  const rows = await db.execute<{
    id: string;
    schoolKey: string;
    version: number;
    body: string;
    createdAt: string | Date;
    createdBy: string;
    versions: number;
  }>(sql`
    select distinct on (v.school_id)
      v.id, s.key as "schoolKey", v.version, v.body, v.created_at as "createdAt",
      st.name as "createdBy", count(*) over (partition by v.school_id)::int as versions
    from school_agreement_versions v
    join schools s on s.id = v.school_id
    join staff_users st on st.id = v.created_by_staff_id
    order by v.school_id, v.version desc
  `);
  return [...rows].map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
}

export async function listAgreementVersions(db: Executor, schoolKey: string) {
  return db
    .select({
      id: schema.schoolAgreementVersions.id,
      version: schema.schoolAgreementVersions.version,
      body: schema.schoolAgreementVersions.body,
      createdAt: schema.schoolAgreementVersions.createdAt,
      createdBy: schema.staffUsers.name,
    })
    .from(schema.schoolAgreementVersions)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAgreementVersions.schoolId))
    .innerJoin(
      schema.staffUsers,
      eq(schema.staffUsers.id, schema.schoolAgreementVersions.createdByStaffId),
    )
    .where(eq(schema.schools.key, schoolKey))
    .orderBy(desc(schema.schoolAgreementVersions.version));
}

/**
 * Adds the next version. Two saves racing for one number collide on the unique
 * key, and the caller turns that into a conflict rather than a gap.
 */
export async function insertAgreementVersion(
  db: Executor,
  values: { schoolId: string; body: string; createdByStaffId: string },
) {
  const rows = await db
    .insert(schema.schoolAgreementVersions)
    .values({
      ...values,
      version: sql`(select coalesce(max(version), 0) + 1 from school_agreement_versions where school_id = ${values.schoolId})`,
    })
    .returning({ version: schema.schoolAgreementVersions.version });
  return rows[0]!.version;
}

/** The cycle's change history: one indexed read of the audit rows filed under it. */
export async function listCycleAudit(db: Executor, cycleId: string, limit: number) {
  return db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
      who: schema.staffUsers.name,
    })
    .from(schema.auditLogs)
    .leftJoin(
      schema.staffUsers,
      and(
        eq(schema.auditLogs.actorType, "STAFF"),
        sql`${schema.staffUsers.id}::text = ${schema.auditLogs.actorId}`,
      ),
    )
    .where(
      and(
        eq(schema.auditLogs.entityType, "admission_cycles"),
        eq(schema.auditLogs.entityId, cycleId),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(limit);
}

export async function replaceDocumentRequirements(
  db: Executor,
  cycleId: string,
  schoolId: string,
  stage: DocumentStage,
  documents: readonly { type: DocumentType; required: boolean }[],
) {
  await db
    .delete(schema.documentRequirements)
    .where(
      and(
        eq(schema.documentRequirements.admissionCycleId, cycleId),
        eq(schema.documentRequirements.schoolId, schoolId),
        eq(schema.documentRequirements.stage, stage),
      ),
    );

  if (documents.length > 0) {
    await db.insert(schema.documentRequirements).values(
      documents.map((document) => ({
        admissionCycleId: cycleId,
        schoolId,
        stage,
        type: document.type,
        required: document.required,
      })),
    );
  }
}
