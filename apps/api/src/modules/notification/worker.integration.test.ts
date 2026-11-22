import { createDatabase, schema } from "@mbs/db";
import { asc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTables } from "../../test/reset.ts";
import { submitApplication } from "../application/service.ts";
import { createFakeMailer, messageIdFor, type Mailer } from "./email.ts";
import { claimDue } from "./outbox.ts";
import { createNotificationWorker, MAX_ATTEMPTS, type NotificationWorker } from "./worker.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);
afterAll(() => db.$client.end());

const log = Fastify({ logger: false }).log;

let source: { applicationId: string; eventId: string };

beforeEach(async () => {
  await resetTables(db, [
    schema.notificationAttempts,
    schema.notifications,
    schema.auditLogs,
    schema.applicationEvents,
    schema.applicantProfileVersions,
    schema.applicationDocumentRequirements,
    schema.applicationAccess,
    schema.applications,
    schema.schoolAdmissionSettings,
    schema.admissionCycles,
    schema.user,
  ]);
  await db.insert(schema.schools).values({ key: "smp" }).onConflictDoNothing();
  await db.insert(schema.user).values({
    id: "family-1",
    name: "family-1",
    email: "family-1@example.test",
    emailVerified: true,
    updatedAt: new Date(),
  });
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name: "2027/2028",
      registrationOpenAt: new Date(Date.now() - 86_400_000),
      registrationCloseAt: new Date(Date.now() + 86_400_000),
      resultPublishAt: new Date(Date.now() + 2 * 86_400_000),
      defaultFee: 250_000,
      status: "OPEN",
    })
    .returning();
  const { application, event } = await submitApplication(
    db,
    {
      cycleId: cycle!.id,
      schoolKey: "smp",
      userId: "family-1",
      profile: {
        childFullName: "Aisyah Putri",
        nik: "6472 0101 0101 0001",
        birthDate: "2014-05-01",
        sex: "FEMALE",
        schoolOfOrigin: "SD Negeri 1 Samarinda",
        guardianName: "Budi",
        guardianRelation: "Ayah",
        guardianPhone: "081234567890",
      },
      idempotencyKey: null,
    },
    { familyAppUrl: "http://localhost:5173" },
  );
  source = { applicationId: application.id, eventId: event.id };
  await db.delete(schema.notifications);
});

const workers: NotificationWorker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((each) => each.stop()));
});

function worker(
  mailer: Mailer,
  options: Partial<Parameters<typeof createNotificationWorker>[0]> = {},
) {
  const created = createNotificationWorker({ db, mailer, log, ...options });
  workers.push(created);
  return created;
}

async function queue(count = 1) {
  return db
    .insert(schema.notifications)
    .values(
      Array.from({ length: count }, (_, index) => ({
        ...source,
        channel: "EMAIL" as const,
        templateKey: "payment-approved",
        templateVersion: 1,
        recipient: `wali-${index}@example.test`,
        subject: `Pembayaran sudah dikonfirmasi (SMP-${String(index).padStart(4, "0")})`,
        bodyText: "Halo.",
        bodyHtml: "<p>Halo.</p>",
      })),
    )
    .returning();
}

async function rowOf(id: string) {
  const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id));
  return row!;
}

async function attemptsOf(id: string) {
  return db
    .select()
    .from(schema.notificationAttempts)
    .where(eq(schema.notificationAttempts.notificationId, id))
    .orderBy(asc(schema.notificationAttempts.attempt));
}

async function makeDue(id: string) {
  await db
    .update(schema.notifications)
    .set({ nextAttemptAt: sql`now()` })
    .where(eq(schema.notifications.id, id));
}

describe("notification worker", () => {
  it("records a failed send and sends it on the retry", async () => {
    const mailer = createFakeMailer();
    const [row] = await queue();
    mailer.failNext();
    const running = worker(mailer);

    await running.poll();
    const waiting = await rowOf(row!.id);
    expect(waiting).toMatchObject({ status: "PENDING", attemptCount: 1, sentAt: null });
    const wait = waiting.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(50_000);
    expect(wait).toBeLessThan(70_000);
    await running.poll();
    expect(mailer.sent).toEqual([]);

    await makeDue(row!.id);
    await running.poll();

    expect(await rowOf(row!.id)).toMatchObject({ status: "SENT", attemptCount: 2 });
    expect(mailer.sent.map((message) => message.id)).toEqual([row!.id]);
    expect(await attemptsOf(row!.id)).toMatchObject([
      { attempt: 1, outcome: "FAILED", errorClass: "ECONNECTION", responseCode: null },
      { attempt: 2, outcome: "SENT", responseCode: "250", errorClass: null },
    ]);
  });

  it("gives up after a fixed number of tries", async () => {
    const mailer = createFakeMailer();
    const [row] = await queue();
    mailer.failNext(MAX_ATTEMPTS + 1);
    const running = worker(mailer);

    for (let attempt = 0; attempt < MAX_ATTEMPTS + 1; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await makeDue(row!.id);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await running.poll();
    }

    expect(await rowOf(row!.id)).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS });
    expect(await attemptsOf(row!.id)).toHaveLength(MAX_ATTEMPTS);
  });

  it("takes over a row whose worker died after sending, with the same Message-ID", async () => {
    const mailer = createFakeMailer();
    const [row] = await queue();

    const running = worker(mailer);

    const [claimed] = await claimDue(db, 10, 60);
    await mailer.send({ id: claimed!.id, to: claimed!.recipient, subject: "", text: "", html: "" });
    await running.poll();
    expect(mailer.sent).toHaveLength(1);

    await db
      .update(schema.notifications)
      .set({ leaseUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.notifications.id, row!.id));
    await running.poll();

    expect(await rowOf(row!.id)).toMatchObject({ status: "SENT", attemptCount: 2 });
    expect(await attemptsOf(row!.id)).toMatchObject([
      { attempt: 1, outcome: "DELIVERY_UNKNOWN" },
      { attempt: 2, outcome: "SENT" },
    ]);
    const ids = mailer.sent.map((message) => messageIdFor(message.id, "mbss.test"));
    expect(new Set(ids).size).toBe(1);
  });

  it("claims nothing in a worker that does not hold the lock", async () => {
    const aMailer = createFakeMailer();
    const bMailer = createFakeMailer();
    const rows = await queue(60);
    const a = worker(aMailer, { batchSize: 7 });
    const b = worker(bMailer, { batchSize: 7 });

    let claimed = await a.poll();
    while (claimed > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const counts = await Promise.all([b.poll(), a.poll(), b.poll()]);
      claimed = counts.reduce((sum, count) => sum + count, 0);
    }

    const sent = aMailer.sent.map((message) => message.id);
    expect(sent).toHaveLength(rows.length);
    expect(new Set(sent).size).toBe(rows.length);
    expect(bMailer.sent).toEqual([]);
    const statuses = await db
      .select({ status: schema.notifications.status, count: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .groupBy(schema.notifications.status);
    expect(statuses).toEqual([{ status: "SENT", count: rows.length }]);
  });

  it("lets one polling worker send at a time, and another take over when it stops", async () => {
    const lines: { msg: string }[] = [];
    const waitingLog = Fastify({
      logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } },
    }).log;
    const firstMailer = createFakeMailer();
    const secondMailer = createFakeMailer();
    const first = worker(firstMailer, { pollMs: 20 });
    const second = worker(secondMailer, { log: waitingLog, pollMs: 20 });
    const allSent = async () => {
      const left = await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(sql`${schema.notifications.status} <> 'SENT'`);
      expect(left).toEqual([]);
    };

    await queue(1);
    first.start();
    await vi.waitFor(() => expect(firstMailer.sent).toHaveLength(1));
    second.start();
    await queue(3);
    await vi.waitFor(allSent);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(firstMailer.sent).toHaveLength(4);
    expect(secondMailer.sent).toEqual([]);
    expect(lines.filter((line) => line.msg.includes("this worker waits"))).toHaveLength(1);

    await first.stop();
    await queue(2);
    await vi.waitFor(allSent);
    await second.stop();
    expect(firstMailer.sent).toHaveLength(4);
    expect(secondMailer.sent).toHaveLength(2);
  });

  it("sends a sign-in code it holds, and fails one it lost in a restart", async () => {
    const mailer = createFakeMailer();
    const first = worker(mailer);
    const held = await first.sendSignInCode("ibu@example.test", "482913", 5);
    await first.poll();
    expect(mailer.sent).toMatchObject([{ id: held, to: "ibu@example.test" }]);
    expect(mailer.sent[0]?.text).toContain("482913");

    await first.sendSignInCode("ibu@example.test", "771204", 5);
    await first.stop();
    await worker(mailer).poll();

    const rows = await db
      .select()
      .from(schema.notifications)
      .orderBy(asc(schema.notifications.createdAt));
    expect(rows.map((row) => [row.status, row.subject, row.bodyText])).toEqual([
      ["SENT", null, null],
      ["FAILED", null, null],
    ]);
    expect(await attemptsOf(rows[1]!.id)).toMatchObject([
      { outcome: "FAILED", errorClass: "CodeUnavailable" },
    ]);
    expect(mailer.sent).toHaveLength(1);
  });

  it("fails a row whose sends keep killing their worker, after the fixed number of tries", async () => {
    const mailer = createFakeMailer();
    const [row] = await queue();
    await db
      .update(schema.notifications)
      .set({
        status: "SENDING",
        attemptCount: MAX_ATTEMPTS,
        leaseUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(schema.notifications.id, row!.id));

    await worker(mailer).poll();

    expect(mailer.sent).toEqual([]);
    expect(await rowOf(row!.id)).toMatchObject({
      status: "FAILED",
      attemptCount: MAX_ATTEMPTS + 1,
    });
    expect(await attemptsOf(row!.id)).toMatchObject([
      { attempt: MAX_ATTEMPTS, outcome: "DELIVERY_UNKNOWN" },
      { attempt: MAX_ATTEMPTS + 1, outcome: "FAILED", errorClass: "TooManyAttempts" },
    ]);
  });

  it("sends a sign-in code ahead of a backlog", async () => {
    const mailer = createFakeMailer();
    await queue(30);
    const running = worker(mailer, { batchSize: 5 });
    const code = await running.sendSignInCode("ayah@example.test", "135790", 5);

    await running.poll();

    expect(mailer.sent[0]?.id).toBe(code);
  });

  it("hands back the rest of a batch when it stops mid-send", async () => {
    const inner = createFakeMailer();
    const { promise: sending, resolve: started } = Promise.withResolvers<void>();
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const slow = {
      ...inner,
      async send(message: Parameters<typeof inner.send>[0]) {
        started();
        await held;
        return inner.send(message);
      },
    };
    const rows = await queue(4);
    const running = worker(slow);
    const batch = running.poll();
    await sending;
    const stopped = running.stop();
    release();
    await Promise.all([batch, stopped]);

    expect(inner.sent).toHaveLength(1);
    const left = await db
      .select({
        status: schema.notifications.status,
        attemptCount: schema.notifications.attemptCount,
      })
      .from(schema.notifications);
    expect(left.filter((row) => row.status === "SENT")).toHaveLength(1);
    expect(left.filter((row) => row.status === "PENDING")).toEqual(
      Array.from({ length: rows.length - 1 }, () => ({ status: "PENDING", attemptCount: 0 })),
    );
  });
  it("refuses to start again once stopped, and closes its mailer once", async () => {
    const closes = vi.fn();
    const running = worker({ ...createFakeMailer(), close: closes });
    running.start();
    await Promise.all([running.stop(), running.stop()]);

    expect(() => running.start()).toThrow();
    await expect(running.sendSignInCode("ibu@example.test", "482913", 5)).rejects.toThrow();
    await running.stop();
    expect(closes).toHaveBeenCalledTimes(1);
  });
});

describe("the outbox table", () => {
  const email = {
    channel: "EMAIL" as const,
    templateKey: "payment-approved",
    templateVersion: 1,
    recipient: "wali@example.test",
    subject: "Pembayaran sudah dikonfirmasi",
    bodyText: "Halo.",
  };
  const code = { ...email, templateKey: "sign-in-code", subject: null, bodyText: null };

  it.each([
    ["an application email without its event", () => email],
    [
      "an application email with only its application",
      () => ({ ...email, applicationId: source.applicationId }),
    ],
    ["a sign-in code tied to an application", () => ({ ...code, ...source })],
  ])("refuses %s", async (_, values) => {
    await expect(db.insert(schema.notifications).values(values())).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "notifications_event_kept" },
    });
  });
});
