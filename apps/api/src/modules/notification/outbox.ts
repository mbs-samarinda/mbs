import { ApplicantProfile } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { SIGN_IN_CODE_TEMPLATE, type SchoolKey } from "@mbs/school-config";
import { and, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";

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

const CODE_CAP = { codes: 5, minutes: 15 };

/**
 * Null while an address may be sent another code. Stops one inbox from being
 * flooded, which the per-IP limit cannot. Every code counts, sent or not, whether
 * or not the address has an account.
 */
export async function reachedCodeCap(db: Database, recipient: string) {
  const n = schema.notifications;
  const codes = await db
    .select({
      age: sql<number>`extract(epoch from now() - ${n.createdAt})::float`,
      status: n.status,
    })
    .from(n)
    .where(
      and(
        eq(n.recipient, recipient),
        // Written out, not a parameter, so the partial index can serve it.
        eq(n.templateKey, sql.raw(`'${SIGN_IN_CODE_TEMPLATE}'`)),
        gt(n.createdAt, sql`now() - make_interval(mins => ${CODE_CAP.minutes})`),
      ),
    )
    .orderBy(desc(n.createdAt))
    .limit(CODE_CAP.codes);
  const newest = codes[0];
  const oldest = codes[CODE_CAP.codes - 1];
  if (!newest || !oldest) return null;
  return {
    newestFailed: newest.status === "FAILED",
    retryAfterSeconds: Math.max(1, Math.ceil(CODE_CAP.minutes * 60 - oldest.age)),
  };
}

export async function claimNext(
  db: Database,
  leaseSeconds: number,
  from: "queue" | { codes: string[] },
): Promise<NotificationRow | null> {
  const n = schema.notifications;
  const a = schema.notificationAttempts;
  const scope =
    from === "queue"
      ? sql`template_key <> ${SIGN_IN_CODE_TEMPLATE}`
      : sql`template_key = ${SIGN_IN_CODE_TEMPLATE} and ${inArray(n.id, from.codes)}`;
  return db.transaction(async (tx) => {
    const [claim] = await tx.execute<{ id: string }>(sql`
      with due as (
        select id, attempt_count, status = 'SENDING' as reclaimed
        from ${n}
        where ((status = 'PENDING' and next_attempt_at <= now())
            or (status = 'SENDING' and lease_until <= now()))
          and ${scope}
        order by next_attempt_at
        limit 1
        for update skip locked
      ), unknown as (
        insert into ${a} (notification_id, attempt, outcome)
        select id, attempt_count, 'DELIVERY_UNKNOWN' from due where reclaimed
        on conflict do nothing
      )
      update ${n}
      set status = 'SENDING',
          attempt_count = ${n.attemptCount} + 1,
          lease_until = now() + make_interval(secs => ${leaseSeconds}),
          updated_at = now()
      from due
      where ${n.id} = due.id
      returning ${n.id} as id
    `);
    if (!claim) return null;

    const [row] = await tx.select().from(n).where(eq(n.id, claim.id));
    return row ?? null;
  });
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
          attempt_count = ${n.attemptCount} + case when gone.reclaimed then 0 else 1 end,
          lease_until = null,
          updated_at = now()
      from gone
      where ${n.id} = gone.id
      returning ${n.id} as id, ${n.attemptCount} as attempt, gone.reclaimed as reclaimed
    )
    insert into ${a} (notification_id, attempt, outcome, error_class)
    select id, attempt,
           (case when reclaimed then 'DELIVERY_UNKNOWN' else 'FAILED' end)::notification_attempt_outcome,
           'CodeUnavailable'
    from failed
    on conflict do nothing
  `);
}

export async function undoClaim(db: Database, row: NotificationRow) {
  const n = schema.notifications;
  await db
    .update(n)
    .set({
      status: "PENDING",
      leaseUntil: null,
      attemptCount: row.attemptCount - 1,
      updatedAt: sql`now()`,
    })
    .where(and(eq(n.id, row.id), eq(n.status, "SENDING"), eq(n.attemptCount, row.attemptCount)));
}

export async function recordSent(db: Database, row: NotificationRow, responseCode: string | null) {
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
  row: NotificationRow,
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
  row: NotificationRow,
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
