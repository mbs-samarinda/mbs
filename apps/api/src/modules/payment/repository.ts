import { PAYMENT_QUEUE_PAGE_SIZE } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

type Reader = Database | Transaction;

const {
  applicantProfileVersions,
  applicationAccess,
  applications,
  files,
  paymentReviews,
  payments,
  schools,
} = schema;

export type PaymentRow = typeof payments.$inferSelect;

/** The newest saved form of one application, as a subquery for one child's name. */
const newestProfile = (column: string) =>
  sql<string>`(
    select ${applicantProfileVersions.data}->>${sql.raw(`'${column}'`)}
    from ${applicantProfileVersions}
    where ${applicantProfileVersions.applicationId} = ${applications.id}
    order by ${applicantProfileVersions.version} desc
    limit 1
  )`;

export async function insertPayment(
  tx: Transaction,
  row: typeof payments.$inferInsert,
): Promise<PaymentRow> {
  const [inserted] = await tx.insert(payments).values(row).returning();
  return inserted!;
}

export async function insertReview(tx: Transaction, row: typeof paymentReviews.$inferInsert) {
  await tx.insert(paymentReviews).values(row);
}

/** One application's attempts, oldest first, each with its file and its decision. */
export async function listAttempts(tx: Reader, applicationId: string) {
  return tx
    .select({
      id: payments.id,
      amountDue: payments.amountDue,
      sentAt: payments.createdAt,
      objectKey: files.objectKey,
      contentType: files.contentType,
      byteSize: files.byteSize,
      decision: paymentReviews.decision,
      reason: paymentReviews.reason,
    })
    .from(payments)
    .innerJoin(files, eq(files.id, payments.fileId))
    .leftJoin(paymentReviews, eq(paymentReviews.paymentId, payments.id))
    .where(eq(payments.applicationId, applicationId))
    .orderBy(asc(payments.createdAt));
}

const PAYMENT_FOR_STAFF = {
  payment: payments,
  schoolKey: schools.key,
  childName: newestProfile("childFullName"),
  guardianName: newestProfile("guardianName"),
  registrationNumber: applications.registrationNumber,
  file: { objectKey: files.objectKey, contentType: files.contentType, byteSize: files.byteSize },
  decided: sql<boolean>`exists (
    select 1 from ${paymentReviews} where ${paymentReviews.paymentId} = ${payments.id}
  )`,
};

/** One proof, limited to the caller's schools. Anything else is NOT_FOUND. */
export async function findPaymentForStaff(
  tx: Reader,
  paymentId: string,
  schoolKeys: readonly string[],
) {
  const [found] = await tx
    .select(PAYMENT_FOR_STAFF)
    .from(payments)
    .innerJoin(applications, eq(applications.id, payments.applicationId))
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoin(files, eq(files.id, payments.fileId))
    .where(and(eq(payments.id, paymentId), inArray(schools.key, [...schoolKeys])))
    .limit(1);
  return found ?? null;
}

/** The application a family may pay for. One that is not theirs does not exist. */
export async function loadApplicationForPayment(tx: Reader, applicationId: string, userId: string) {
  const [found] = await tx
    .select({
      id: applications.id,
      admissionCycleId: applications.admissionCycleId,
      registrationNumber: applications.registrationNumber,
      registrationFee: applications.registrationFee,
      stage: applications.stage,
      schoolKey: schools.key,
      childName: newestProfile("childFullName"),
    })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoin(
      applicationAccess,
      and(
        eq(applicationAccess.applicationId, applications.id),
        eq(applicationAccess.userId, userId),
      ),
    )
    .where(eq(applications.id, applicationId))
    .limit(1);
  return found ?? null;
}

/**
 * The attempt the desk is deciding on, locked, with everything a decision
 * needs. Locking the row is what makes two staff deciding at once take turns.
 */
export async function lockPaymentForReview(tx: Transaction, paymentId: string) {
  const [found] = await tx
    .select(PAYMENT_FOR_STAFF)
    .from(payments)
    .innerJoin(applications, eq(applications.id, payments.applicationId))
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoin(files, eq(files.id, payments.fileId))
    .where(eq(payments.id, paymentId))
    .limit(1)
    .for("update", { of: payments });
  return found ?? null;
}

/** How many attempts came before this one, so the desk can say "unggahan ke-N". */
export async function countAttemptsUpTo(tx: Reader, payment: PaymentRow) {
  const [row] = await tx
    .select({ total: count() })
    .from(payments)
    .where(
      and(
        eq(payments.applicationId, payment.applicationId),
        eq(payments.purpose, payment.purpose),
        lte(payments.createdAt, payment.createdAt),
      ),
    );
  return row?.total ?? 1;
}

/**
 * Every proof still waiting in the caller's schools, oldest first: the family
 * that has waited longest is the one the committee should open next.
 */
export async function listWaitingProofs(tx: Reader, schoolKeys: readonly string[], page: number) {
  const waiting = and(
    isNull(paymentReviews.id),
    inArray(schools.key, [...schoolKeys]),
    eq(applications.stage, "PAYMENT_REVIEW"),
  );

  const [[total], rows] = await Promise.all([
    tx
      .select({ total: count() })
      .from(payments)
      .innerJoin(applications, eq(applications.id, payments.applicationId))
      .innerJoin(schools, eq(schools.id, applications.schoolId))
      .leftJoin(paymentReviews, eq(paymentReviews.paymentId, payments.id))
      .where(waiting),
    tx
      .select({
        paymentId: payments.id,
        applicationId: applications.id,
        registrationNumber: applications.registrationNumber,
        schoolKey: schools.key,
        amountDue: payments.amountDue,
        sentAt: payments.createdAt,
        childName: newestProfile("childFullName"),
        attempt: sql<number>`(
          select count(*)::int from ${payments} earlier
          where earlier.application_id = ${applications.id}
            and earlier.purpose = ${payments.purpose}
            and earlier.created_at <= ${payments.createdAt}
        )`,
      })
      .from(payments)
      .innerJoin(applications, eq(applications.id, payments.applicationId))
      .innerJoin(schools, eq(schools.id, applications.schoolId))
      .leftJoin(paymentReviews, eq(paymentReviews.paymentId, payments.id))
      .where(waiting)
      .orderBy(asc(payments.createdAt))
      .limit(PAYMENT_QUEUE_PAGE_SIZE)
      .offset((page - 1) * PAYMENT_QUEUE_PAGE_SIZE),
  ]);

  return { rows, total: total?.total ?? 0 };
}

/** The newest attempt on one application, whether or not it was decided. */
export async function findNewestPayment(tx: Reader, applicationId: string) {
  const [found] = await tx
    .select()
    .from(payments)
    .where(eq(payments.applicationId, applicationId))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return found ?? null;
}
