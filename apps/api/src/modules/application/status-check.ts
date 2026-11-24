import type { CheckedStatus, CheckStatusInput } from "@mbs/api-contract";
import { APPLICANT_RULES } from "@mbs/api-contract/applicant-rules";
import { schema, type Database, type Transaction } from "@mbs/db";
import { finishedMilestones, isSchoolKey } from "@mbs/school-config";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { NoMatchError, TooManyTriesError } from "../../errors.ts";
import { appendAuditLog } from "../audit.ts";
import { parseRegistrationNumber } from "./registration-number.ts";
import { findApplicationByNumber, listFamilyVisibleEvents } from "./repository.ts";
import type { RequestMeta } from "./service.ts";
import { familyStage } from "./stages.ts";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

const LIMITS = {
  /** Wrong tries from one address. */
  ADDRESS: [{ max: 20, seconds: 15 * MINUTE }],
  /**
   * Right ones, far above what a phone network's shared address sends on the day
   * of the results. It only keeps a loop from filling the record.
   */
  RIGHT: [{ max: 300, seconds: 15 * MINUTE }],
  /** Wrong tries on one number, whether or not the number exists. */
  NUMBER: [
    { max: 5, seconds: 15 * MINUTE },
    { max: 20, seconds: DAY },
  ],
} as const;
type Kind = keyof typeof LIMITS;

const { statusCheckTries } = schema;

/**
 * Shows one application to whoever knows its number and the child's NIK. Someone
 * who knows the child's birth date and district can guess a NIK in few tries, so
 * the limits are what protects it.
 */
export async function checkStatus(
  db: Database,
  input: CheckStatusInput,
  caller: { userId: string | null; meta: RequestMeta },
): Promise<CheckedStatus> {
  const number = parseRegistrationNumber(input.registrationNumber);
  const nik = APPLICANT_RULES.nik(input.nik);
  const address = caller.meta.ipAddress ?? "unknown";

  // Without the lock and the transaction, so a flood from one address does not
  // hold the connections that everyone else's requests need. Wrong tries are
  // counted again below, where none can slip past.
  const floodWait = Math.max(
    await secondsToWait(db, "ADDRESS", address),
    await secondsToWait(db, "RIGHT", address),
  );
  if (floodWait > 0) throw new TooManyTriesError(floodWait);

  // Refusals are returned, not thrown, because a throw would undo the count.
  const outcome = await db.transaction(async (tx) => {
    const fromAddress = await takeTry(tx, "ADDRESS", address);
    if (!fromAddress.taken) return fromAddress;
    // Text that is no number counts per address, so one visitor's typos never
    // lock out another's.
    const onNumber = await takeTry(tx, "NUMBER", number ?? `unreadable from ${address}`);
    if (!onNumber.taken) return onNumber;

    const found = await findApplicationByNumber(tx, number ?? "", nik.ok ? nik.value : "");
    const events = found ? await listFamilyVisibleEvents(tx, found.id) : [];
    if (found) {
      await tx.delete(statusCheckTries).where(eq(statusCheckTries.id, onNumber.tryId));
      await tx
        .update(statusCheckTries)
        .set({ subject: subjectOf("RIGHT", address) })
        .where(eq(statusCheckTries.id, fromAddress.tryId));
    }
    await forgetOldTries(tx);
    await appendAuditLog(tx, {
      actorType: caller.userId ? "FAMILY" : "PUBLIC",
      actorId: caller.userId,
      action: "application.status_checked",
      entityType: "application",
      entityId: found?.id ?? "unknown",
      metadata: { found: found !== null },
      ...caller.meta,
    });
    return { taken: true as const, found, events };
  });

  if (!outcome.taken) throw new TooManyTriesError(outcome.retryAfterSeconds);
  const { found, events } = outcome;
  if (!found) throw new NoMatchError("No application matches.");
  if (!isSchoolKey(found.schoolKey)) throw new Error(`Unknown school ${found.schoolKey}.`);
  return {
    registrationNumber: found.registrationNumber,
    schoolKey: found.schoolKey,
    childName: found.childName,
    stage: familyStage(found.stage),
    finished: finishedMilestones(
      events.map(({ command, createdAt }) => ({ command, at: createdAt.toISOString() })),
    ),
  };
}

type Try = { taken: true; tryId: string } | { taken: false; retryAfterSeconds: number };

/**
 * Counts a try before its answer is known. The lock holds until the transaction
 * ends, in this and every other API process, so tries on one subject take turns.
 * Addresses are always locked before numbers, and the two never share a lock, so
 * no two requests can wait for each other. A refused try is not counted.
 */
async function takeTry(tx: Transaction, kind: Kind, about: string): Promise<Try> {
  const subject = subjectOf(kind, about);
  // A statement of its own: the count must see what the lock waited for.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`status_check_tries.${kind}`}), hashtext(${subject}))`,
  );
  const retryAfterSeconds = await secondsToWait(tx, kind, about);
  if (retryAfterSeconds > 0) return { taken: false, retryAfterSeconds };

  const [row] = await tx
    .insert(statusCheckTries)
    .values({ subject })
    .returning({ id: statusCheckTries.id });
  return { taken: true, tryId: row!.id };
}

async function secondsToWait(db: Database | Transaction, kind: Kind, about: string) {
  const waits = await Promise.all(
    LIMITS[kind].map(async ({ max, seconds }) => {
      // The limit is reached while the max-th newest try is inside the window.
      const [row] = await db
        .select({
          wait: sql<number>`ceil(extract(epoch from ${statusCheckTries.createdAt} + make_interval(secs => ${seconds}) - clock_timestamp()))::int`,
        })
        .from(statusCheckTries)
        .where(eq(statusCheckTries.subject, subjectOf(kind, about)))
        .orderBy(desc(statusCheckTries.createdAt))
        .offset(max - 1)
        .limit(1);
      return row?.wait ?? 0;
    }),
  );
  return Math.max(...waits);
}

function subjectOf(kind: Kind, about: string) {
  return `${kind} ${about}`;
}

/** A few at a time, and more than a try adds, so the table stays a day long. */
async function forgetOldTries(tx: Transaction) {
  const old = tx
    .select({ id: statusCheckTries.id })
    .from(statusCheckTries)
    .where(sql`${statusCheckTries.createdAt} < clock_timestamp() - make_interval(secs => ${DAY})`)
    .limit(20)
    .for("update", { skipLocked: true });
  await tx.delete(statusCheckTries).where(inArray(statusCheckTries.id, old));
}
