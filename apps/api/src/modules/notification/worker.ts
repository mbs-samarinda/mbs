import { randomUUID } from "node:crypto";

import type { Database } from "@mbs/db";
import { SIGN_IN_CODE_TEMPLATE } from "@mbs/school-config";
import type { FastifyBaseLogger } from "fastify";

import { SendError, type Mailer, type OutgoingEmail } from "./email.ts";
import {
  claimDue,
  insertSignInCodeNotification,
  recordFailure,
  recordLeaseExpired,
  recordSent,
  releaseUntried,
  renewLease,
  type ClaimedNotification,
} from "./outbox.ts";
import { TEMPLATES, type RenderedEmail } from "./templates.ts";

export const RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

export const WORKER_LOCK_KEY = 7_316_041;

type WorkerOptions = {
  db: Database;
  mailer: Mailer;
  log: FastifyBaseLogger;
  leaseSeconds?: number;
  pollMs?: number;
  batchSize?: number;
  now?: () => Date;
};

export type NotificationWorker = ReturnType<typeof createNotificationWorker>;

export function createNotificationWorker(options: WorkerOptions) {
  const { db, mailer, log } = options;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const pollMs = options.pollMs ?? 5_000;
  const batchSize = options.batchSize ?? 20;
  const now = options.now ?? (() => new Date());

  const codes = new Map<string, { email: RenderedEmail; expiresAt: number }>();
  let timer: NodeJS.Timeout | null = null;
  let ticking: Promise<void> | null = null;
  let current: Promise<number> | null = null;
  let lock: Awaited<ReturnType<typeof db.$client.reserve>> | null = null;
  let waitingForLock = false;
  let again = false;
  let running = false;
  let stopping = false;

  async function sendOne(row: ClaimedNotification) {
    if (row.reclaimed) {
      await recordLeaseExpired(db, row);
      if (row.attemptCount > MAX_ATTEMPTS) {
        codes.delete(row.id);
        await recordFailure(db, row, {
          errorClass: "TooManyAttempts",
          responseCode: null,
          retryAt: null,
        });
        return;
      }
    }

    const email = messageOf(row);
    if (!email) {
      codes.delete(row.id);
      await recordFailure(db, row, {
        errorClass: "CodeUnavailable",
        responseCode: null,
        retryAt: null,
      });
      return;
    }

    if (!(await renewLease(db, row, leaseSeconds))) return;
    try {
      const { responseCode } = await mailer.send({ id: row.id, to: row.recipient, ...email });
      if (!(await recordSent(db, row, responseCode))) {
        log.warn({ notificationId: row.id }, "notification sent after its lease ran out");
      }
      codes.delete(row.id);
    } catch (error) {
      const failure = error instanceof SendError ? error : new SendError("Unknown", null);
      const retryAt = retryTime(row);
      await recordFailure(db, row, {
        errorClass: failure.errorClass,
        responseCode: failure.responseCode,
        retryAt,
      });
      if (!retryAt) codes.delete(row.id);
      log.warn(
        {
          notificationId: row.id,
          attempt: row.attemptCount,
          errorClass: failure.errorClass,
          responseCode: failure.responseCode,
          retrying: retryAt !== null,
        },
        "notification send failed",
      );
    }
  }

  function messageOf(row: ClaimedNotification): Omit<OutgoingEmail, "id" | "to"> | null {
    if (row.templateKey === SIGN_IN_CODE_TEMPLATE) {
      const held = codes.get(row.id);
      if (!held || held.expiresAt <= now().getTime()) return null;
      return held.email;
    }
    if (row.subject === null || row.bodyText === null) return null;
    return { subject: row.subject, text: row.bodyText, html: row.bodyHtml ?? "" };
  }

  function retryTime(row: ClaimedNotification) {
    const minutes = RETRY_MINUTES[row.attemptCount - 1];
    if (minutes === undefined) return null;
    const at = new Date(now().getTime() + minutes * 60_000);
    const code = codes.get(row.id);
    if (code && code.expiresAt <= at.getTime()) return null;
    return at;
  }

  async function sendBatch() {
    const rows = await claimDue(db, batchSize, leaseSeconds);
    for (const [index, row] of rows.entries()) {
      if (stopping) {
        const untried = rows.slice(index);
        // oxlint-disable-next-line eslint/no-await-in-loop
        await Promise.all(
          untried.filter((left) => left.reclaimed).map((left) => recordLeaseExpired(db, left)),
        );
        // oxlint-disable-next-line eslint/no-await-in-loop
        await releaseUntried(db, untried);
        break;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await sendOne(row);
    }
    return rows.length;
  }

  function runOnce(): Promise<number> {
    if (current) {
      again = true;
      return current;
    }
    current = sendBatch().finally(() => {
      current = null;
    });
    return current;
  }

  async function holdLock() {
    if (lock) {
      const still = await lock<{ held: boolean }[]>`
        select exists (
          select from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and granted
            and classid = 0 and objid = ${WORKER_LOCK_KEY}::oid and objsubid = 1
        ) as held
      `.then(
        ([row]) => row?.held === true,
        () => false,
      );
      if (still) return true;
      lock.release();
      lock = null;
    }
    const reserved = await db.$client.reserve();
    let held: boolean;
    try {
      const [row] = await reserved<{ held: boolean }[]>`
        select pg_try_advisory_lock(${WORKER_LOCK_KEY}::bigint) as held
      `;
      held = row?.held === true;
    } catch (error) {
      reserved.release();
      throw error;
    }
    if (held) {
      if (waitingForLock) log.info("notification worker took over the outbox");
      waitingForLock = false;
      lock = reserved;
      return true;
    }
    reserved.release();
    if (!waitingForLock) log.info("another process sends the outbox; this worker waits");
    waitingForLock = true;
    return false;
  }

  async function releaseLock() {
    if (!lock) return;
    await lock`select pg_advisory_unlock(${WORKER_LOCK_KEY}::bigint)`.catch(() => undefined);
    lock.release();
    lock = null;
  }

  async function tick() {
    timer = null;
    let claimed = 0;
    let held = false;
    try {
      held = await holdLock();
      if (held) claimed = await runOnce();
    } catch (error) {
      log.error(
        { errorClass: error instanceof Error ? error.constructor.name : typeof error },
        "notification worker failed a batch",
      );
    }
    if (!running) return;
    const busy = held && (claimed >= batchSize || again);
    again = false;
    schedule(busy ? 0 : pollMs);
  }

  function schedule(ms: number) {
    timer = setTimeout(() => {
      ticking = tick().finally(() => {
        ticking = null;
      });
    }, ms);
  }

  function wake() {
    if (!running) return;
    if (timer) {
      clearTimeout(timer);
      schedule(0);
    } else {
      again = true;
    }
  }

  return {
    runOnce,
    wake,

    start() {
      if (running) return;
      running = true;
      schedule(0);
    },

    async stop() {
      running = false;
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await ticking;
      await current?.catch(() => undefined);
      await releaseLock();
      codes.clear();
      mailer.close();
    },

    async sendSignInCode(recipient: string, code: string, minutes: number) {
      const id = randomUUID();
      codes.set(id, {
        email: TEMPLATES[SIGN_IN_CODE_TEMPLATE].render({ code, minutes }),
        expiresAt: now().getTime() + minutes * 60_000,
      });
      try {
        await insertSignInCodeNotification(db, id, recipient);
      } catch (error) {
        codes.delete(id);
        throw error;
      }
      wake();
      return id;
    },
  };
}
