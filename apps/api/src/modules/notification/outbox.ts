import { ApplicantProfile } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { SIGN_IN_CODE_TEMPLATE, type SchoolKey } from "@mbs/school-config";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { findLatestProfileVersion } from "../application/repository.ts";
import { TEMPLATES, type EventTemplateKey } from "./templates.ts";

export type NotificationRow = typeof schema.notifications.$inferSelect;

/** What the outbox needs from the app's configuration. */
export type OutboxSettings = {
  /** The parent app, linked from every application email. */
  familyAppUrl: string;
};

/**
 * Queues one email per account that holds access to the application, inside
 * the caller's transaction, so the email exists exactly when the event does.
 * Rendered now, with the template's current version, and stored whole: the
 * record shows what each family was told. The unique index on event and user
 * makes a second call for the same event a no-op.
 */
export async function enqueueEventEmails(
  tx: Transaction,
  input: {
    applicationId: string;
    eventId: string;
    schoolKey: SchoolKey;
    registrationNumber: string;
    payload: unknown;
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
  // Only the name: a profile written by an older form still has one.
  const { childFullName } = ApplicantProfile.pick({ childFullName: true }).parse(profile?.data);

  const template = TEMPLATES[input.template];
  const rendered = template.render({
    childName: childFullName,
    schoolKey: input.schoolKey,
    registrationNumber: input.registrationNumber,
    reason: stringField(input.payload, "reason"),
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

/**
 * The record of a sign-in code email: who, which template, and what happened
 * to it. Never the code, so never the subject or body either.
 */
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
  /** The row was SENDING under a lease that ran out: its last try was lost. */
  reclaimed: boolean;
};

/**
 * Takes up to `limit` rows that are due, or whose worker's lease ran out, and
 * leases them in one statement. SKIP LOCKED lets two workers claim at once
 * without waiting on, or taking, each other's rows. The claim counts as a try.
 */
export async function claimDue(db: Database, limit: number, leaseSeconds: number) {
  const n = schema.notifications;
  const rows = await db.execute<{ id: string; reclaimed: boolean }>(sql`
    with due as (
      select id, status = 'SENDING' as reclaimed
      from ${n}
      where (status = 'PENDING' and next_attempt_at <= now())
         or (status = 'SENDING' and lease_until <= now())
      -- A sign-in code is good for minutes, so it never waits behind a burst.
      order by (template_key = ${SIGN_IN_CODE_TEMPLATE}) desc, next_attempt_at
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
    // The worker sends in this order, so codes go first here too.
    .orderBy(sql`${n.templateKey} = ${SIGN_IN_CODE_TEMPLATE} desc`, n.nextAttemptAt);
  return claimed.map((row): ClaimedNotification => ({
    ...row,
    reclaimed: reclaimed.get(row.id) ?? false,
  }));
}

/**
 * Extends this worker's lease right before a send, so a long batch never
 * sends a row whose lease already ran out. False when another worker took it.
 */
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

/**
 * Hands a claimed row back untried, for a worker that stops mid-batch. The
 * claim did not become a try, so its count is taken back.
 */
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

/** Records the try a crashed or stalled worker never reported. */
export async function recordLeaseExpired(db: Database, row: ClaimedNotification) {
  await db
    .insert(schema.notificationAttempts)
    .values({ notificationId: row.id, attempt: row.attemptCount - 1, outcome: "LEASE_EXPIRED" })
    .onConflictDoNothing();
}

/**
 * Marks the row SENT and appends the attempt, only while this worker still
 * holds the claim. Returns false when the lease ran out and another worker
 * took the row over: that worker records this try as LEASE_EXPIRED.
 */
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

/**
 * Appends the failed attempt, then either schedules the next try or, with
 * `retryAt` null, gives up on the row.
 */
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

function stringField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return null;
  const field: unknown = new Map(Object.entries(value)).get(key);
  return typeof field === "string" && field.length > 0 ? field : null;
}
