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

/** Minutes to wait after the first, second, ... failed try. Then it fails for good. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

type WorkerOptions = {
  db: Database;
  mailer: Mailer;
  log: FastifyBaseLogger;
  /** How long a claimed row stays this worker's. Longer than the mailer's timeouts. */
  leaseSeconds?: number;
  pollMs?: number;
  batchSize?: number;
  /** The clock retries are scheduled from. Tests move it. */
  now?: () => Date;
};

export type NotificationWorker = ReturnType<typeof createNotificationWorker>;

/**
 * Sends the outbox from inside the API process. Every send runs with no
 * transaction open: a row is claimed in one statement, sent, then marked in a
 * second. Delivery is at least once (see `messageIdFor`).
 *
 * Sign-in codes are the exception to "the row holds the message". The code
 * lives only in this process's memory until it is sent. A restart loses it,
 * and its row then fails at once: a new code is one tap away, and a stored
 * code would be a live secret in the database. So only one process may run
 * the worker: another would claim a code it does not hold and fail it.
 */
export function createNotificationWorker(options: WorkerOptions) {
  const { db, mailer, log } = options;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const pollMs = options.pollMs ?? 5_000;
  const batchSize = options.batchSize ?? 20;
  const now = options.now ?? (() => new Date());

  const codes = new Map<string, { email: RenderedEmail; expiresAt: number }>();
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<number> | null = null;
  let again = false;
  let running = false;
  let stopping = false;

  async function sendOne(row: ClaimedNotification) {
    if (row.reclaimed) {
      await recordLeaseExpired(db, row);
      // A send that kills or stalls its worker every time must still stop.
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

  /** Null when this was the last try, or a code would expire before the next. */
  function retryTime(row: ClaimedNotification) {
    const minutes = RETRY_MINUTES[row.attemptCount - 1];
    if (minutes === undefined) return null;
    const at = new Date(now().getTime() + minutes * 60_000);
    const code = codes.get(row.id);
    if (code && code.expiresAt <= at.getTime()) return null;
    return at;
  }

  /** Claims and sends one batch. Returns how many rows it claimed. */
  async function sendBatch() {
    const rows = await claimDue(db, batchSize, leaseSeconds);
    for (const [index, row] of rows.entries()) {
      // Shutdown waits for one send, not a whole batch against a dead server.
      if (stopping) {
        const untried = rows.slice(index);
        // A reclaimed row's lost try is history even if this worker never tries it.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await Promise.all(
          untried.filter((left) => left.reclaimed).map((left) => recordLeaseExpired(db, left)),
        );
        // oxlint-disable-next-line eslint/no-await-in-loop
        await releaseUntried(db, untried);
        break;
      }
      // One at a time over one pooled connection: an SMTP server limits
      // parallel sessions, and a batch is small.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await sendOne(row);
    }
    return rows.length;
  }

  /** Runs a batch now, or right after the one in flight. Never two at once. */
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

  async function tick() {
    timer = null;
    let claimed = 0;
    try {
      claimed = await runOnce();
    } catch (error) {
      log.error(
        { errorClass: error instanceof Error ? error.constructor.name : typeof error },
        "notification worker failed a batch",
      );
    }
    if (!running) return;
    const busy = claimed >= batchSize || again;
    again = false;
    timer = setTimeout(() => void tick(), busy ? 0 : pollMs);
  }

  /** Sends now instead of at the next poll. */
  function wake() {
    if (!running) return;
    if (timer) {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), 0);
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
      timer = setTimeout(() => void tick(), 0);
    },

    /** Stops polling and waits for the send in flight, so the pool can close after. */
    async stop() {
      running = false;
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await current?.catch(() => undefined);
      codes.clear();
      mailer.close();
    },

    /**
     * Queues a sign-in code email. The row is the record; the code stays in
     * memory until it is sent or expires.
     */
    async sendSignInCode(recipient: string, code: string, minutes: number) {
      // The code is in memory before the row exists, so no claim can find a
      // row without its code.
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
