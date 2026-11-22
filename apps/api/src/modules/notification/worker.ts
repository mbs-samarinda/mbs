import { randomUUID } from "node:crypto";

import { createSessionConnection, type Database, type SessionConnection } from "@mbs/db";
import { SIGN_IN_CODE_TEMPLATE } from "@mbs/school-config";
import type { FastifyBaseLogger } from "fastify";

import { SendError, SMTP_TIMEOUT_MS, type Mailer, type OutgoingEmail } from "./email.ts";
import {
  claimDue,
  failAbandonedCodes,
  insertSignInCodeNotification,
  recordFailure,
  recordDeliveryUnknown,
  recordSent,
  releaseUntried,
  renewLease,
  type ClaimedNotification,
} from "./outbox.ts";
import { TEMPLATES, type RenderedEmail } from "./templates.ts";

export const RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const LEASE_SECONDS = (6 * SMTP_TIMEOUT_MS) / 1000;

export const WORKER_LOCK_KEY = 7_316_041;

class LockTimeout extends Error {}

type WorkerOptions = {
  db: Database;
  databaseUrl: string;
  mailer: Mailer;
  log: FastifyBaseLogger;
  codeMinutes: number;
  leaseSeconds?: number;
  pollMs?: number;
  timeoutMs?: number;
  batchSize?: number;
  now?: () => Date;
};

export type NotificationWorker = ReturnType<typeof createNotificationWorker>;

export function createNotificationWorker(options: WorkerOptions) {
  const { db, mailer, log, codeMinutes } = options;
  const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS;
  const pollMs = options.pollMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const batchSize = options.batchSize ?? 20;
  const now = options.now ?? (() => new Date());

  const codes = new Map<string, { email: RenderedEmail; expiresAt: number }>();
  let timer: NodeJS.Timeout | null = null;
  let ticking: Promise<void> | null = null;
  let current: Promise<number> | null = null;
  let codeTimer: NodeJS.Timeout | null = null;
  let sendingCodes: Promise<void> | null = null;
  let codesAgain = false;
  let lock: SessionConnection | null = null;
  let lockState: "held" | "waiting" | "failing" | null = null;
  let running = false;
  let stopped: Promise<void> | null = null;

  async function sendOne(row: ClaimedNotification) {
    if (row.reclaimed) {
      await recordDeliveryUnknown(db, row);
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

  async function sendRows(rows: ClaimedNotification[]) {
    for (const [index, row] of rows.entries()) {
      if (stopped) {
        const untried = rows.slice(index);
        // oxlint-disable-next-line eslint/no-await-in-loop
        await Promise.all(
          untried.filter((left) => left.reclaimed).map((left) => recordDeliveryUnknown(db, left)),
        );
        // oxlint-disable-next-line eslint/no-await-in-loop
        await releaseUntried(db, untried);
        return;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await sendOne(row);
    }
  }

  async function sendBatch() {
    await failAbandonedCodes(db, codeMinutes * 60 + leaseSeconds);
    const rows = await claimDue(db, batchSize, leaseSeconds, "queue");
    await sendRows(rows);
    return rows.length;
  }

  function runBatch(): Promise<number> {
    current ??= sendBatch().finally(() => {
      current = null;
    });
    return current;
  }

  async function sendCodes() {
    if (codes.size > 0) {
      const rows = await claimDue(db, batchSize, leaseSeconds, { codes: [...codes.keys()] });
      if (rows.length >= batchSize) codesAgain = true;
      await sendRows(rows);
    }
    const at = now().getTime();
    for (const [id, held] of codes) if (held.expiresAt <= at) codes.delete(id);
  }

  function wake() {
    if (stopped) return;
    if (sendingCodes) {
      codesAgain = true;
      return;
    }
    if (codeTimer) clearTimeout(codeTimer);
    codeTimer = null;
    sendingCodes = sendCodes()
      .catch((error: unknown) => {
        log.error(
          { errorClass: classOf(error) },
          "notification worker failed to send sign-in codes",
        );
      })
      .finally(() => {
        sendingCodes = null;
        if (codesAgain) {
          codesAgain = false;
          wake();
        } else if (codes.size > 0 && !stopped) {
          codeTimer = setTimeout(wake, pollMs);
        }
      });
  }

  function bounded<T>(work: Promise<T>) {
    let timeout: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new LockTimeout()), timeoutMs);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timeout));
  }

  async function holdLock() {
    if (lock) {
      const lost = await bounded(lock<{ held: boolean }[]>`
        select exists (
          select from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and granted
            and classid = 0 and objid = ${WORKER_LOCK_KEY}::oid and objsubid = 1
        ) as held
      `).then(([row]) => (row?.held === true ? null : "LockGone"), classOf);
      if (!lost) return true;
      log.warn({ errorClass: lost }, "notification worker lost the outbox lock");
      lockState = "failing";
      void dropLock();
    }
    const connection = createSessionConnection(options.databaseUrl);
    let failure: string | null = null;
    const held = await bounded(connection<{ held: boolean }[]>`
      select pg_try_advisory_lock(${WORKER_LOCK_KEY}::bigint) as held
    `).then(
      ([row]) => row?.held === true,
      (error: unknown) => {
        failure = classOf(error);
        return false;
      },
    );
    if (held) {
      if (lockState) log.info({ after: lockState }, "notification worker took the outbox lock");
      lockState = "held";
      lock = connection;
      return true;
    }
    void connection.end({ timeout: 0 });
    if (failure) {
      if (lockState !== "failing") {
        log.warn({ errorClass: failure }, "notification worker could not take the outbox lock");
      }
      lockState = "failing";
    } else {
      if (lockState !== "waiting") log.info("another process sends the outbox; this worker waits");
      lockState = "waiting";
    }
    return false;
  }

  async function dropLock() {
    const held = lock;
    lock = null;
    await held?.end({ timeout: 0 });
  }

  async function tick() {
    timer = null;
    let claimed = 0;
    let held = false;
    try {
      held = await holdLock();
      if (held) claimed = await runBatch();
    } catch (error) {
      log.error({ errorClass: classOf(error) }, "notification worker failed a batch");
    }
    if (!running) return;
    schedule(held && claimed >= batchSize ? 0 : pollMs);
  }

  function schedule(ms: number) {
    timer = setTimeout(() => {
      ticking = tick().finally(() => {
        ticking = null;
      });
    }, ms);
  }

  return {
    async poll() {
      return (await holdLock()) ? runBatch() : 0;
    },

    start() {
      if (stopped) throw new Error("A stopped notification worker cannot start again");
      if (running) return;
      running = true;
      schedule(0);
    },

    stop() {
      stopped ??= (async () => {
        running = false;
        if (timer) clearTimeout(timer);
        if (codeTimer) clearTimeout(codeTimer);
        timer = null;
        codeTimer = null;
        await bounded(Promise.all([ticking, current, sendingCodes])).catch(() => undefined);
        await bounded(dropLock()).catch(() => undefined);
        codes.clear();
        mailer.close();
      })();
      return stopped;
    },

    async sendSignInCode(recipient: string, code: string) {
      if (stopped) throw new Error("A stopped notification worker cannot send");
      const id = randomUUID();
      codes.set(id, {
        email: TEMPLATES[SIGN_IN_CODE_TEMPLATE].render({ code, minutes: codeMinutes }),
        expiresAt: now().getTime() + codeMinutes * 60_000,
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

function classOf(error: unknown) {
  return error instanceof Error ? error.constructor.name : typeof error;
}
