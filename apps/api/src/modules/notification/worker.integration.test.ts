import { randomUUID } from "node:crypto";
import { connect, createServer, type Socket } from "node:net";

import { createDatabase, schema } from "@mbs/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTables } from "../../test/reset.ts";
import { submitApplication } from "../application/service.ts";
import { createFakeMailer, messageIdFor, type Mailer } from "./email.ts";
import { insertSignInCodeNotification } from "./outbox.ts";
import {
  createNotificationWorker,
  MAX_ATTEMPTS,
  WORKER_LOCK_KEY,
  type NotificationWorker,
} from "./worker.ts";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core";
const db = createDatabase(databaseUrl);
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
        guardianRelation: "FATHER",
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
  const created = createNotificationWorker({
    db,
    databaseUrl,
    mailer,
    log,
    codeMinutes: 5,
    ...options,
  });
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

function capturedLog() {
  const lines: { level: number; msg: string; errorClass?: string; after?: string }[] = [];
  const captured = Fastify({
    logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } },
  }).log;
  return { lines, log: captured };
}

async function lockHolders() {
  return db.execute<{ pid: number }>(sql`
    select pid from pg_locks
    where locktype = 'advisory' and granted and classid = 0
      and objid = ${WORKER_LOCK_KEY}::oid and objsubid = 1
  `);
}

async function stallingProxy() {
  const target = new URL(databaseUrl);
  const sockets: Socket[] = [];
  const stalled = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    sockets.push(client);
    for (const [from, to] of [
      [client, upstream],
      [upstream, client],
    ] as const) {
      from.on("data", (chunk) => {
        if (!stalled.has(client)) to.write(chunk);
      });
      from.on("close", () => to.destroy());
      from.on("error", () => to.destroy());
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("proxy has no port");
  const url = new URL(databaseUrl);
  url.host = `127.0.0.1:${address.port}`;
  return {
    url: url.toString(),
    stallFirstConnection() {
      stalled.add(sockets[0]!);
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

async function refusingSentAttempts(run: () => Promise<void>, id?: string) {
  await db.execute(sql`alter table notification_attempts drop constraint if exists no_sent`);
  const others = id ? `notification_id <> '${id}'` : "false";
  await db.execute(
    sql.raw(
      `alter table notification_attempts add constraint no_sent check (outcome <> 'SENT' or ${others}) not valid`,
    ),
  );
  try {
    await run();
  } finally {
    await db.execute(sql`alter table notification_attempts drop constraint no_sent`);
  }
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
    await mailer.send({ id: row!.id, to: row!.recipient, subject: "", text: "", html: "" });
    await db
      .update(schema.notifications)
      .set({ status: "SENDING", attemptCount: 1, leaseUntil: sql`now() + interval '1 minute'` })
      .where(eq(schema.notifications.id, row!.id));
    const running = worker(mailer);

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

  it("sends a row whose own lease runs out during the send", async () => {
    const fake = createFakeMailer();
    const rows = await queue(3);
    let first = true;
    const slow: Mailer = {
      ...fake,
      async send(message) {
        if (first) {
          first = false;
          await db
            .update(schema.notifications)
            .set({ leaseUntil: sql`now() - interval '1 second'` })
            .where(eq(schema.notifications.status, "SENDING"));
        }
        return fake.send(message);
      },
    };

    await worker(slow).poll();

    expect(fake.sent).toHaveLength(3);
    for (const row of rows) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect(await rowOf(row.id)).toMatchObject({ status: "SENT", attemptCount: 1 });
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect(await attemptsOf(row.id)).toMatchObject([{ attempt: 1, outcome: "SENT" }]);
    }
  });

  it("counts no try for rows a dead worker never reached", async () => {
    const { promise: sending, resolve: started } = Promise.withResolvers<void>();
    const { promise: died, resolve: die } = Promise.withResolvers<void>();
    const rows = await queue(3);
    const hung: Mailer = {
      ...createFakeMailer(),
      async send() {
        started();
        await died;
        throw new Error("died");
      },
    };
    const polling = worker(hung).poll();
    await sending;

    const statuses = await Promise.all(rows.map((row) => rowOf(row.id)));
    die();
    await polling;

    expect(statuses.map((row) => row.attemptCount).toSorted((a, b) => a - b)).toEqual([0, 0, 1]);
    expect(statuses.map((row) => row.status).toSorted()).toEqual(["PENDING", "PENDING", "SENDING"]);
  });

  it("stops sending mid-batch once its lock is gone", async () => {
    const fake = createFakeMailer();
    await queue(3);
    const losing: Mailer = {
      ...fake,
      async send(message) {
        const [holder] = await lockHolders();
        if (holder) await db.execute(sql`select pg_terminate_backend(${holder.pid})`);
        return fake.send(message);
      },
    };

    await worker(losing).poll();

    expect(fake.sent).toHaveLength(1);
  });

  it("never records an accepted email as a failed send", async () => {
    const fake = createFakeMailer();
    const [row] = await queue();
    const { lines, log: captured } = capturedLog();
    const running = worker(fake, { log: captured });
    await refusingSentAttempts(() => expect(running.poll()).rejects.toThrow());

    expect(await rowOf(row!.id)).toMatchObject({ status: "SENDING", attemptCount: 1 });
    expect(await attemptsOf(row!.id)).toEqual([]);
    expect(fake.sent).toHaveLength(1);
    expect(lines).toMatchObject([
      { msg: "notification was sent but not recorded as sent", errorClass: "PostgresError 23514" },
    ]);
  });

  it("sends the other codes when one cannot be recorded, and does not send that one again", async () => {
    const fake = createFakeMailer();
    const { lines, log: captured } = capturedLog();
    const idle = worker(fake, { log: captured, pollMs: 60_000 });
    fake.failNext(2);
    const lost = await idle.sendSignInCode("ibu@example.test", "482913");
    const second = await idle.sendSignInCode("ayah@example.test", "135790");
    await vi.waitFor(() =>
      expect(lines.filter((line) => line.msg === "notification send failed")).toHaveLength(2),
    );
    await vi.waitFor(async () => {
      expect(await rowOf(lost)).toMatchObject({ status: "PENDING", attemptCount: 1 });
      expect(await rowOf(second)).toMatchObject({ status: "PENDING", attemptCount: 1 });
    });
    await makeDue(lost);
    await makeDue(second);
    let third = "";
    await refusingSentAttempts(async () => {
      third = await idle.sendSignInCode("wali@example.test", "246802");
      await vi.waitFor(async () => {
        expect(await rowOf(second)).toMatchObject({ status: "SENT" });
        expect(await rowOf(third)).toMatchObject({ status: "SENT" });
      });
    }, lost);
    expect(fake.sent.map((message) => message.id)).toEqual([lost, second, third]);
    await db
      .update(schema.notifications)
      .set({
        createdAt: sql`now() - interval '1 hour'`,
        leaseUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(schema.notifications.id, lost));

    await idle.poll();

    expect(fake.sent).toHaveLength(3);
    expect(await attemptsOf(lost)).toMatchObject([
      { attempt: 1, outcome: "FAILED", errorClass: "ECONNECTION" },
      { attempt: 2, outcome: "DELIVERY_UNKNOWN", errorClass: "CodeUnavailable" },
    ]);
  });

  it("records a send on the second try when the first write fails", async () => {
    const fake = createFakeMailer();
    const [row] = await queue();
    let transactions = 0;
    const failsOnce = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return (run: Parameters<typeof db.transaction>[0]) => {
          transactions += 1;
          // The claim is the first transaction, the record of the send the second.
          if (transactions === 2) return Promise.reject(new Error("connection lost"));
          return target.transaction(run);
        };
      },
    });

    await worker(fake, { db: failsOnce }).poll();

    // The last transaction is the claim that finds the queue empty.
    expect(transactions).toBe(4);
    expect(await rowOf(row!.id)).toMatchObject({ status: "SENT", attemptCount: 1 });
    expect(fake.sent).toHaveLength(1);
  });

  it.each([
    { status: "PENDING", attemptCount: 0, attempts: [] },
    {
      status: "SENDING",
      attemptCount: MAX_ATTEMPTS,
      attempts: [{ attempt: MAX_ATTEMPTS, outcome: "DELIVERY_UNKNOWN" }],
    },
  ] as const)(
    "undoes the claim of a $status row when it stops",
    async ({ attempts, ...before }) => {
      const fake = createFakeMailer();
      const [row] = await queue();
      const leaseUntil = before.status === "SENDING" ? sql`now() - interval '1 second'` : null;
      await db
        .update(schema.notifications)
        .set({ ...before, leaseUntil })
        .where(eq(schema.notifications.id, row!.id));
      let claims = 0;
      const stopsDuringClaim = new Proxy(db, {
        get(target, key, receiver) {
          if (key !== "transaction") return Reflect.get(target, key, receiver);
          return (run: Parameters<typeof db.transaction>[0]) => {
            claims += 1;
            void stoppable.stop();
            return target.transaction(run);
          };
        },
      });
      const stoppable: NotificationWorker = worker(fake, { db: stopsDuringClaim });

      await stoppable.poll();

      expect(claims).toBe(1);
      expect(await rowOf(row!.id)).toMatchObject({
        status: "PENDING",
        attemptCount: before.attemptCount,
        leaseUntil: null,
      });
      expect(await attemptsOf(row!.id)).toMatchObject(attempts);
      expect(fake.sent).toEqual([]);
    },
  );

  it("does not send an undone row that already used up its tries", async () => {
    const fake = createFakeMailer();
    const [row] = await queue();
    await db
      .update(schema.notifications)
      .set({ attemptCount: MAX_ATTEMPTS })
      .where(eq(schema.notifications.id, row!.id));

    await worker(fake).poll();

    expect(fake.sent).toEqual([]);
    expect(await rowOf(row!.id)).toMatchObject({ status: "FAILED" });
    expect(await attemptsOf(row!.id)).toMatchObject([
      { attempt: MAX_ATTEMPTS + 1, outcome: "FAILED", errorClass: "TooManyAttempts" },
    ]);
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
    const { lines, log: waitingLog } = capturedLog();
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

  it("sends a sign-in code from the process that made it, while another holds the lock", async () => {
    const aMailer = createFakeMailer();
    const bMailer = createFakeMailer();
    const a = worker(aMailer, { pollMs: 20 });
    const b = worker(bMailer, { pollMs: 20 });
    await a.poll();
    a.start();
    b.start();

    const code = await b.sendSignInCode("ibu@example.test", "482913");

    await vi.waitFor(() => expect(bMailer.sent).toMatchObject([{ id: code }]));
    expect(bMailer.sent[0]?.text).toContain("482913");
    expect(aMailer.sent).toEqual([]);
    await vi.waitFor(async () =>
      expect(await rowOf(code)).toMatchObject({ status: "SENT", subject: null, bodyText: null }),
    );
  });

  it("sends a sign-in code with the polling worker off, past a backlog it leaves alone", async () => {
    const mailer = createFakeMailer();
    await queue(30);
    const idle = worker(mailer, { batchSize: 5 });

    const code = await idle.sendSignInCode("ayah@example.test", "135790");

    await vi.waitFor(() => expect(mailer.sent.map((message) => message.id)).toEqual([code]));
    const waiting = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.status, "PENDING"));
    expect(waiting).toHaveLength(30);
  });

  it("retries a sign-in code that failed to send", async () => {
    const mailer = createFakeMailer();
    mailer.failNext();
    const idle = worker(mailer, { pollMs: 20 });

    const code = await idle.sendSignInCode("ibu@example.test", "482913");
    await vi.waitFor(async () =>
      expect(await rowOf(code)).toMatchObject({ status: "PENDING", attemptCount: 1 }),
    );
    await makeDue(code);

    await vi.waitFor(async () => expect(await rowOf(code)).toMatchObject({ status: "SENT" }));
    expect(mailer.sent).toMatchObject([{ id: code }]);
    expect(await attemptsOf(code)).toMatchObject([
      { attempt: 1, outcome: "FAILED", errorClass: "ECONNECTION" },
      { attempt: 2, outcome: "SENT" },
    ]);
  });

  it("fails a sign-in code whose process lost it, once the code would have run out", async () => {
    const mailer = createFakeMailer();
    const running = worker(mailer);
    const [fresh, lost, mid] = [randomUUID(), randomUUID(), randomUUID()];
    await insertSignInCodeNotification(db, fresh, "ibu@example.test");
    await insertSignInCodeNotification(db, lost, "ayah@example.test");
    await insertSignInCodeNotification(db, mid, "wali@example.test");
    await db
      .update(schema.notifications)
      .set({ createdAt: sql`now() - interval '1 hour'` })
      .where(inArray(schema.notifications.id, [lost, mid]));
    await db
      .update(schema.notifications)
      .set({ status: "SENDING", attemptCount: 1, leaseUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.notifications.id, mid));

    await running.poll();
    await running.poll();

    expect(mailer.sent).toEqual([]);
    expect(await rowOf(fresh)).toMatchObject({ status: "PENDING", attemptCount: 0 });
    expect(await rowOf(lost)).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(await attemptsOf(lost)).toMatchObject([
      { attempt: 1, outcome: "FAILED", errorClass: "CodeUnavailable" },
    ]);
    expect(await rowOf(mid)).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(await attemptsOf(mid)).toMatchObject([
      { attempt: 1, outcome: "DELIVERY_UNKNOWN", errorClass: "CodeUnavailable" },
    ]);
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

  it("claims nothing more once it stops mid-send", async () => {
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
  it("stops while its lock check hangs, and lets go of the lock", async () => {
    const proxy = await stallingProxy();
    const proxied = createDatabase(proxy.url);
    const running = worker(createFakeMailer(), {
      db: proxied,
      databaseUrl: proxy.url,
      pollMs: 20,
      timeoutMs: 200,
    });
    running.start();
    await vi.waitFor(async () => expect(await lockHolders()).toHaveLength(1));

    proxy.stallFirstConnection();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const stopping = Date.now();
    await running.stop();

    expect(Date.now() - stopping).toBeLessThan(1_000);
    await vi.waitFor(async () => expect(await lockHolders()).toEqual([]));
    await proxied.$client.end({ timeout: 0 });
    proxy.close();
  });

  it("logs when its lock check hangs, and again when it takes the lock back", async () => {
    const proxy = await stallingProxy();
    const proxied = createDatabase(proxy.url);
    const { lines, log: capture } = capturedLog();
    const running = worker(createFakeMailer(), {
      db: proxied,
      databaseUrl: proxy.url,
      log: capture,
      pollMs: 20,
      timeoutMs: 200,
    });
    running.start();
    await vi.waitFor(async () => expect(await lockHolders()).toHaveLength(1));
    const [before] = await lockHolders();

    proxy.stallFirstConnection();

    await vi.waitFor(async () => {
      const holders = await lockHolders();
      expect(holders).toHaveLength(1);
      expect(holders[0]?.pid).not.toBe(before?.pid);
    });
    const lost = lines.findIndex((line) => line.msg === "notification worker lost the outbox lock");
    const taken = lines.findIndex(
      (line) => line.msg === "notification worker took the outbox lock",
    );
    expect(lines[lost]).toMatchObject({ level: 40, errorClass: "LockTimeout" });
    expect(taken).toBeGreaterThan(lost);
    await running.stop();
    await proxied.$client.end({ timeout: 0 });
    proxy.close();
  });

  it("takes the lock back on a fresh connection after its session is killed", async () => {
    const mailer = createFakeMailer();
    const running = worker(mailer, { pollMs: 20 });
    running.start();
    await vi.waitFor(async () => expect(await lockHolders()).toHaveLength(1));
    const [killed] = await lockHolders();

    await db.execute(sql`select pg_terminate_backend(${killed!.pid})`);

    await vi.waitFor(async () => {
      const holders = await lockHolders();
      expect(holders).toHaveLength(1);
      expect(holders[0]?.pid).not.toBe(killed!.pid);
    });
    const [holder] = await lockHolders();
    const pooled = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`),
      ),
    );
    expect(pooled.map(([row]) => row?.pid)).not.toContain(holder!.pid);
    const [row] = await queue();
    await vi.waitFor(() => expect(mailer.sent.map((message) => message.id)).toEqual([row!.id]));

    await running.stop();
    expect(await lockHolders()).toEqual([]);
  });

  it("never takes the lock once stopped", async () => {
    const running = worker(createFakeMailer());
    await running.stop();

    expect(await running.poll()).toBe(0);
    expect(await lockHolders()).toEqual([]);
  });

  it("refuses to start again once stopped, and closes its mailer once", async () => {
    const closes = vi.fn();
    const running = worker({ ...createFakeMailer(), close: closes });
    running.start();
    await Promise.all([running.stop(), running.stop()]);

    expect(() => running.start()).toThrow();
    await expect(running.sendSignInCode("ibu@example.test", "482913")).rejects.toThrow();
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
