import { ApplicantProfile } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { SIGN_IN_CODE_TEMPLATE, type SchoolKey } from "@mbs/school-config";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { findLatestProfileVersion } from "../application/repository.ts";
import { TEMPLATES, type EventTemplateKey } from "./templates.ts";

export type NotificationRow = typeof schema.notifications.$inferSelect;

export type OutboxSettings = {
  familyAppUrl: string;
};

export async function enqueueEventEmails(
  tx: Transaction,
  input: {
    applicationId: string;
    eventId: string;
    schoolKey: SchoolKey;
    registrationNumber: string;
    staffReason: string | null;
    template: EventTemplateKey;
    settings: OutboxSettings;
  },
) {
  const recipients = await tx
    .select({ userId: schema.user.id, email: schema.user.email })
    .from(schema.applicationAccess)
    .innerJoin(schema.user, eq(schema.user.id, schema.applicationAccess.userId))
    .where(eq(schema.applicationAccess.applicationId, input.applicationId));
  if (recipients.length === 0) return;

  const profile = await findLatestProfileVersion(tx, input.applicationId);
  const { childFullName } = ApplicantProfile.pick({ childFullName: true }).parse(profile?.data);

  const template = TEMPLATES[input.template];
  const rendered = template.render({
    childName: childFullName,
    schoolKey: input.schoolKey,
    registrationNumber: input.registrationNumber,
    reason: input.staffReason,
    appUrl: input.settings.familyAppUrl,
  });

  await tx
    .insert(schema.notifications)
    .values(
      recipients.map((recipient) => ({
        applicationId: input.applicationId,
        eventId: input.eventId,
        userId: recipient.userId,
        channel: "EMAIL" as const,
        templateKey: input.template,
        templateVersion: template.version,
        recipient: recipient.email,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
      })),
    )
    .onConflictDoNothing();
}

export async function insertSignInCodeNotification(db: Database, id: string, recipient: string) {
  const [account] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, recipient));
  await db.insert(schema.notifications).values({
    id,
    userId: account?.id ?? null,
    channel: "EMAIL",
    templateKey: SIGN_IN_CODE_TEMPLATE,
    templateVersion: TEMPLATES[SIGN_IN_CODE_TEMPLATE].version,
    recipient,
  });
}

export type ClaimedNotification = NotificationRow & {
  reclaimed: boolean;
};

const signInCodesFirst = sql`(${schema.notifications.templateKey} = ${SIGN_IN_CODE_TEMPLATE}) desc, ${schema.notifications.nextAttemptAt}`;

export async function claimDue(db: Database, limit: number, leaseSeconds: number) {
  const n = schema.notifications;
  const rows = await db.execute<{ id: string; reclaimed: boolean }>(sql`
    with due as (
      select id, status = 'SENDING' as reclaimed
      from ${n}
      where (status = 'PENDING' and next_attempt_at <= now())
         or (status = 'SENDING' and lease_until <= now())
      order by ${signInCodesFirst}
      limit ${limit}
      for update skip locked
    )
    update ${n}
    set status = 'SENDING',
        attempt_count = ${n.attemptCount} + 1,
        lease_until = now() + make_interval(secs => ${leaseSeconds}),
        updated_at = now()
    from due
    where ${n.id} = due.id
    returning ${n.id} as id, due.reclaimed as reclaimed
  `);
  if (rows.length === 0) return [];

  const reclaimed = new Map(rows.map((row) => [row.id, row.reclaimed]));
  const claimed = await db
    .select()
    .from(n)
    .where(inArray(n.id, [...reclaimed.keys()]))
    .orderBy(signInCodesFirst);
  return claimed.map((row): ClaimedNotification => ({
    ...row,
    reclaimed: reclaimed.get(row.id) ?? false,
  }));
}

export async function renewLease(db: Database, row: ClaimedNotification, leaseSeconds: number) {
  const n = schema.notifications;
  const renewed = await db
    .update(n)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})` })
    .where(
      and(
        eq(n.id, row.id),
        eq(n.status, "SENDING"),
        eq(n.attemptCount, row.attemptCount),
        sql`${n.leaseUntil} > now()`,
      ),
    )
    .returning({ id: n.id });
  return renewed.length > 0;
}

export async function releaseUntried(db: Database, rows: ClaimedNotification[]) {
  if (rows.length === 0) return;
  const n = schema.notifications;
  await Promise.all(
    rows.map((row) =>
      db
        .update(n)
        .set({ status: "PENDING", leaseUntil: null, attemptCount: row.attemptCount - 1 })
        .where(
          and(eq(n.id, row.id), eq(n.status, "SENDING"), eq(n.attemptCount, row.attemptCount)),
        ),
    ),
  );
}

export async function recordLeaseExpired(db: Database, row: ClaimedNotification) {
  await db
    .insert(schema.notificationAttempts)
    .values({ notificationId: row.id, attempt: row.attemptCount - 1, outcome: "LEASE_EXPIRED" })
    .onConflictDoNothing();
}

export async function recordSent(
  db: Database,
  row: ClaimedNotification,
  responseCode: string | null,
) {
  return db.transaction(async (tx) => {
    const held = await releaseClaim(tx, row, { status: "SENT", sentAt: sql`now()` });
    if (!held) return false;
    await tx.insert(schema.notificationAttempts).values({
      notificationId: row.id,
      attempt: row.attemptCount,
      outcome: "SENT",
      responseCode,
    });
    return true;
  });
}

export async function recordFailure(
  db: Database,
  row: ClaimedNotification,
  failure: { errorClass: string; responseCode: string | null; retryAt: Date | null },
) {
  return db.transaction(async (tx) => {
    const held = await releaseClaim(
      tx,
      row,
      failure.retryAt
        ? { status: "PENDING", nextAttemptAt: failure.retryAt }
        : { status: "FAILED" },
    );
    if (!held) return false;
    await tx.insert(schema.notificationAttempts).values({
      notificationId: row.id,
      attempt: row.attemptCount,
      outcome: "FAILED",
      responseCode: failure.responseCode,
      errorClass: failure.errorClass,
    });
    return true;
  });
}

async function releaseClaim(
  tx: Transaction,
  row: ClaimedNotification,
  values:
    | { status: "SENT"; sentAt: SQL }
    | { status: "PENDING"; nextAttemptAt: Date }
    | { status: "FAILED" },
) {
  const n = schema.notifications;
  const updated = await tx
    .update(n)
    .set({ ...values, leaseUntil: null, updatedAt: sql`now()` })
    .where(and(eq(n.id, row.id), eq(n.status, "SENDING"), eq(n.attemptCount, row.attemptCount)))
    .returning({ id: n.id });
  return updated.length > 0;
}
