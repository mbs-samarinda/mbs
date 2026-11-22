import type {
  ActorType,
  ApplicantProfile,
  ApplicationCommand,
  ApplicationStage,
  InterviewMode,
} from "@mbs/api-contract";
import { schema, type Transaction } from "@mbs/db";
import { and, desc, eq, sql } from "drizzle-orm";

export type ApplicationRow = typeof schema.applications.$inferSelect;
export type ApplicationEventRow = typeof schema.applicationEvents.$inferSelect;

/**
 * Share-locks the cycle row until the transaction ends. Saving a school's
 * settings and changing the cycle both lock it for update, so they wait for
 * submissions in flight, and a submission waits for them to commit.
 */
export async function lockCycleForSubmission(tx: Transaction, cycleId: string) {
  const rows = await tx
    .select({ id: schema.admissionCycles.id })
    .from(schema.admissionCycles)
    .where(eq(schema.admissionCycles.id, cycleId))
    .for("share");
  return rows.length > 0;
}

/**
 * Everything a submission is decided on: the cycle, the school's settings for
 * it, and whether the database clock is inside the registration window. A
 * school with no settings row takes part at the cycle's defaults.
 *
 * Read only after the locks are held, in its own statement. A query that
 * waits on a row lock re-reads the locked row but keeps its older view of the
 * rows joined to it, so a settings save it waited for would go unseen.
 */
export async function findSubmissionTerms(tx: Transaction, cycleId: string, schoolKey: string) {
  const { registrationOpenAt, registrationCloseAt } = schema.admissionCycles;
  const rows = await tx
    .select({
      status: schema.admissionCycles.status,
      defaultFee: schema.admissionCycles.defaultFee,
      // clock_timestamp(), not now(): now() is when the transaction began,
      // before any wait for the locks.
      inWindow: sql<boolean>`clock_timestamp() >= ${registrationOpenAt} and clock_timestamp() < ${registrationCloseAt}`,
      schoolId: schema.schools.id,
      feeOverride: schema.schoolAdmissionSettings.feeOverride,
      isEnabled: schema.schoolAdmissionSettings.isEnabled,
    })
    .from(schema.admissionCycles)
    .innerJoin(schema.schools, eq(schema.schools.key, schoolKey))
    .leftJoin(
      schema.schoolAdmissionSettings,
      and(
        eq(schema.schoolAdmissionSettings.admissionCycleId, schema.admissionCycles.id),
        eq(schema.schoolAdmissionSettings.schoolId, schema.schools.id),
      ),
    )
    .where(eq(schema.admissionCycles.id, cycleId));

  const row = rows[0];
  if (!row) return null;
  return { ...row, isEnabled: row.isEnabled ?? true };
}

/**
 * Serializes submissions to one school in one cycle until the transaction
 * ends, so two families cannot be handed the same registration number.
 */
export async function lockRegistrationCounter(tx: Transaction, cycleId: string, schoolKey: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('applications.registration_seq'), hashtext(${cycleId} || ':' || ${schoolKey}))`,
  );
}

export async function nextRegistrationSeq(tx: Transaction, cycleId: string, schoolId: string) {
  const [row] = await tx
    .select({
      next: sql<number>`coalesce(max(${schema.applications.registrationSeq}), 0)::int + 1`,
    })
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.admissionCycleId, cycleId),
        eq(schema.applications.schoolId, schoolId),
      ),
    );
  return row!.next;
}

export async function isNikTaken(tx: Transaction, cycleId: string, schoolId: string, nik: string) {
  const rows = await tx
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.admissionCycleId, cycleId),
        eq(schema.applications.schoolId, schoolId),
        eq(schema.applications.nik, nik),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertApplication(
  tx: Transaction,
  values: typeof schema.applications.$inferInsert,
) {
  const [row] = await tx.insert(schema.applications).values(values).returning();
  return row!;
}

/**
 * The registration documents promised at creation: later edits to the cycle's
 * list change nothing here. Registrasi ulang documents are copied when the
 * result is published (PUBLISH_ACCEPTED, built in P10), because the school
 * usually sets them after registration opens.
 */
export async function snapshotDocumentRequirements(
  tx: Transaction,
  applicationId: string,
  cycleId: string,
  schoolId: string,
) {
  await tx.execute(sql`
    insert into ${schema.applicationDocumentRequirements} (application_id, stage, document_type, required)
    select ${applicationId}, stage, document_type, required
    from ${schema.documentRequirements}
    where admission_cycle_id = ${cycleId} and school_id = ${schoolId} and stage = 'APPLICATION'
  `);
}

export async function grantAccess(tx: Transaction, applicationId: string, userId: string) {
  await tx.insert(schema.applicationAccess).values({ applicationId, userId });
}

export async function hasAccess(tx: Transaction, applicationId: string, userId: string) {
  const rows = await tx
    .select({ userId: schema.applicationAccess.userId })
    .from(schema.applicationAccess)
    .where(
      and(
        eq(schema.applicationAccess.applicationId, applicationId),
        eq(schema.applicationAccess.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertProfileVersion(
  tx: Transaction,
  values: { applicationId: string; version: number; data: ApplicantProfile; authorUserId: string },
) {
  const [row] = await tx.insert(schema.applicantProfileVersions).values(values).returning();
  return row!;
}

export async function findLatestProfileVersion(tx: Transaction, applicationId: string) {
  const rows = await tx
    .select()
    .from(schema.applicantProfileVersions)
    .where(eq(schema.applicantProfileVersions.applicationId, applicationId))
    .orderBy(desc(schema.applicantProfileVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function findProfileVersion(tx: Transaction, applicationId: string, version: number) {
  const rows = await tx
    .select()
    .from(schema.applicantProfileVersions)
    .where(
      and(
        eq(schema.applicantProfileVersions.applicationId, applicationId),
        eq(schema.applicantProfileVersions.version, version),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Holds the application row until the transaction ends: one writer at a time. */
export async function lockApplication(tx: Transaction, applicationId: string) {
  const rows = await tx
    .select({ application: schema.applications, schoolKey: schema.schools.key })
    .from(schema.applications)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.applications.schoolId))
    .where(eq(schema.applications.id, applicationId))
    .for("update", { of: schema.applications });
  return rows[0] ?? null;
}

export async function findEventByIdempotencyKey(
  tx: Transaction,
  actorType: ActorType,
  actorId: string,
  idempotencyKey: string,
) {
  const rows = await tx
    .select()
    .from(schema.applicationEvents)
    .where(
      and(
        eq(schema.applicationEvents.actorType, actorType),
        eq(schema.applicationEvents.actorId, actorId),
        eq(schema.applicationEvents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findNewestEventOf(
  tx: Transaction,
  applicationId: string,
  command: ApplicationCommand,
) {
  const rows = await tx
    .select()
    .from(schema.applicationEvents)
    .where(
      and(
        eq(schema.applicationEvents.applicationId, applicationId),
        eq(schema.applicationEvents.command, command),
      ),
    )
    .orderBy(desc(schema.applicationEvents.seq))
    .limit(1);
  return rows[0] ?? null;
}

export async function findApplicationById(tx: Transaction, applicationId: string) {
  const rows = await tx
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, applicationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertEvent(
  tx: Transaction,
  values: typeof schema.applicationEvents.$inferInsert,
) {
  const [row] = await tx.insert(schema.applicationEvents).values(values).returning();
  return row!;
}

export async function recordEventOnApplication(
  tx: Transaction,
  applicationId: string,
  values: {
    stage: ApplicationStage;
    lastEventSeq: number;
    stageChanged: boolean;
    interviewMode: InterviewMode | undefined;
  },
) {
  await tx
    .update(schema.applications)
    .set({
      stage: values.stage,
      lastEventSeq: values.lastEventSeq,
      interviewMode: values.interviewMode,
      // Same-stage commands such as ADD_NOTE leave this alone, so it keeps
      // saying how long the application has waited where it is.
      stageChangedAt: values.stageChanged ? sql`now()` : undefined,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.applications.id, applicationId));
}

export async function updateApplicationNik(tx: Transaction, applicationId: string, nik: string) {
  await tx
    .update(schema.applications)
    .set({ nik, updatedAt: sql`now()` })
    .where(eq(schema.applications.id, applicationId));
}
