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

export async function claimDue(
  db: Database,
  limit: number,
  leaseSeconds: number,
  from: "queue" | { codes: string[] },
) {
  const n = schema.notifications;
  const scope =
    from === "queue"
      ? sql`template_key <> ${SIGN_IN_CODE_TEMPLATE}`
      : sql`template_key = ${SIGN_IN_CODE_TEMPLATE} and ${inArray(n.id, from.codes)}`;
  const rows = await db.execute<{ id: string; reclaimed: boolean }>(sql`
    with due as (
      select id, status = 'SENDING' as reclaimed
      from ${n}
      where ((status = 'PENDING' and next_attempt_at <= now())
          or (status = 'SENDING' and lease_until <= now()))
        and ${scope}
      order by next_attempt_at
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
    .orderBy(n.nextAttemptAt);
  return claimed.map((row): ClaimedNotification => ({
    ...row,
    reclaimed: reclaimed.get(row.id) ?? false,
  }));
}

export async function failAbandonedCodes(db: Database, olderThanSeconds: number) {
  const n = schema.notifications;
  const a = schema.notificationAttempts;
  await db.execute(sql`
    with gone as (
      select id, status = 'SENDING' as reclaimed
      from ${n}
      where template_key = ${SIGN_IN_CODE_TEMPLATE}
        and created_at <= now() - make_interval(secs => ${olderThanSeconds})
        and (status = 'PENDING' or (status = 'SENDING' and lease_until <= now()))
      for update skip locked
    ), failed as (
      update ${n}
      set status = 'FAILED',
          attempt_count = ${n.attemptCount} + 1,
          lease_until = null,
          updated_at = now()
      from gone
      where ${n.id} = gone.id
      returning ${n.id} as id, ${n.attemptCount} as attempt, gone.reclaimed as reclaimed
    ), unknown as (
      insert into ${a} (notification_id, attempt, outcome)
      select id, attempt - 1, 'DELIVERY_UNKNOWN' from failed where reclaimed
      on conflict do nothing
    )
    insert into ${a} (notification_id, attempt, outcome, error_class)
    select id, attempt, 'FAILED', 'CodeUnavailable' from failed
  `);
}

// A lease that ran out while earlier rows in the batch were sending is still
// ours unless another claim raised the attempt count, so expiry alone does not
// lose the row.
export async function renewLease(db: Database, row: ClaimedNotification, leaseSeconds: number) {
  const n = schema.notifications;
  const renewed = await db
    .update(n)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})` })
    .where(and(eq(n.id, row.id), eq(n.status, "SENDING"), eq(n.attemptCount, row.attemptCount)))
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

export async function recordDeliveryUnknown(db: Database, row: ClaimedNotification) {
  await db
    .insert(schema.notificationAttempts)
    .values({ notificationId: row.id, attempt: row.attemptCount - 1, outcome: "DELIVERY_UNKNOWN" })
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
