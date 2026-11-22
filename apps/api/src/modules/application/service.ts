import { isDeepStrictEqual } from "node:util";

import {
  ApplicantProfile,
  COMMAND_PAYLOADS,
  type ApplicantProfileInput,
  type CommandInput,
  type SchoolKey,
} from "@mbs/api-contract";
import type { Database, Transaction } from "@mbs/db";

import {
  ConflictError,
  DuplicateApplicationError,
  ForbiddenError,
  IllegalTransitionError,
  isUniqueViolation,
  NotFoundError,
  RegistrationClosedError,
  StaleSequenceError,
} from "../../errors.ts";
import type { StaffContext } from "../auth/authorization.ts";
import {
  findApplicationById,
  findCycleForSubmission,
  findEventByIdempotencyKey,
  findLatestProfileVersion,
  findProfileVersion,
  grantAccess,
  hasAccess,
  insertApplication,
  insertEvent,
  insertProfileVersion,
  isNikTaken,
  lockApplication,
  lockRegistrationCounter,
  nextRegistrationSeq,
  recordEventOnApplication,
  snapshotDocumentRequirements,
  updateApplicationNik,
  type ApplicationEventRow,
  type ApplicationRow,
} from "./repository.ts";
import { isEndStage, transition } from "./stages.ts";

/**
 * Who is acting. A family acts as its Better Auth user, staff as their staff
 * profile, and a system job by name, such as the result publisher.
 */
export type Actor =
  | { type: "FAMILY"; userId: string }
  | { type: "STAFF"; staff: StaffContext }
  | { type: "SYSTEM"; job: string };

/** Where a write came from. Stored on the event; never personal data beyond the IP. */
export type RequestMeta = {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const DUPLICATE_MESSAGE = "This child has already applied to this school in this cycle.";

function actorId(actor: Actor) {
  if (actor.type === "FAMILY") return actor.userId;
  if (actor.type === "STAFF") return actor.staff.id;
  return actor.job;
}

/**
 * The family registers one child at one school. Everything the application
 * starts with is written in one transaction: the application, the documents it
 * was promised, profile version 1, the family's access and the SUBMIT event.
 *
 * Retrying with the same idempotency key returns the first result.
 */
export async function submitApplication(
  db: Database,
  input: {
    cycleId: string;
    schoolKey: SchoolKey;
    userId: string;
    profile: ApplicantProfileInput;
    idempotencyKey: string | null;
    meta?: RequestMeta;
    now?: Date;
  },
): Promise<{ application: ApplicationRow; event: ApplicationEventRow; replayed: boolean }> {
  const profile = ApplicantProfile.parse(input.profile);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const cycle = await findCycleForSubmission(tx, input.cycleId, input.schoolKey);
    if (!cycle) throw new NotFoundError("No such cycle.");

    await lockRegistrationCounter(tx, input.cycleId, cycle.schoolId);

    // Before the window check, so a retry of a submission that landed just
    // before closing still gets its application back. Under the lock, so a
    // retry that raced its own first attempt still finds it.
    if (input.idempotencyKey) {
      const earlier = await findEventByIdempotencyKey(
        tx,
        "FAMILY",
        input.userId,
        input.idempotencyKey,
      );
      if (earlier) {
        const application = await findApplicationById(tx, earlier.applicationId);
        if (
          earlier.command !== "SUBMIT" ||
          application?.admissionCycleId !== input.cycleId ||
          application.schoolId !== cycle.schoolId
        ) {
          throw reusedKey();
        }
        return { application, event: earlier, replayed: true };
      }
    }

    if (
      cycle.status !== "OPEN" ||
      !cycle.isEnabled ||
      now < cycle.registrationOpenAt ||
      now >= cycle.registrationCloseAt
    ) {
      throw new RegistrationClosedError("Registration is not open at this school.");
    }

    // Names nothing about the other application: the family asking may not
    // be the family that applied.
    if (await isNikTaken(tx, input.cycleId, cycle.schoolId, profile.nik)) {
      throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
    }

    const result = transition(null, "SUBMIT", "FAMILY");
    if (!result.ok) throw new IllegalTransitionError("SUBMIT is not allowed.");

    const seq = await nextRegistrationSeq(tx, input.cycleId, cycle.schoolId);
    const application = await insertApplication(tx, {
      admissionCycleId: input.cycleId,
      schoolId: cycle.schoolId,
      registrationSeq: seq,
      registrationNumber: `${input.schoolKey.toUpperCase()}-${String(seq).padStart(4, "0")}`,
      stage: result.to,
      nik: profile.nik,
      registrationFee: cycle.feeOverride ?? cycle.defaultFee,
      lastEventSeq: 1,
      createdByUserId: input.userId,
    }).catch((error: unknown) => {
      // The lock orders submissions, but a profile save can move another
      // application onto this NIK in between.
      if (isUniqueViolation(error)) throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
      throw error;
    });

    await snapshotDocumentRequirements(tx, application.id, input.cycleId, cycle.schoolId);
    await insertProfileVersion(tx, {
      applicationId: application.id,
      version: 1,
      data: profile,
      authorUserId: input.userId,
    });
    await grantAccess(tx, application.id, input.userId);
    const event = await insertEvent(tx, {
      applicationId: application.id,
      seq: 1,
      command: "SUBMIT",
      fromStage: null,
      toStage: result.to,
      actorType: "FAMILY",
      actorId: input.userId,
      familyVisible: result.familyVisible,
      payload: COMMAND_PAYLOADS.SUBMIT.parse({ payloadVersion: 1 }),
      payloadVersion: 1,
      idempotencyKey: input.idempotencyKey,
      ...input.meta,
    }).catch((error: unknown) => {
      // The same key sent to another school at the same moment.
      if (isUniqueViolation(error)) throw reusedKey();
      throw error;
    });

    return { application, event, replayed: false };
  });
}

/**
 * Runs one command on an application through the stage table. In one
 * transaction it locks the application, replays an idempotency key the actor
 * already used, checks `expectedSeq` against the newest event, appends the
 * event and moves the application.
 */
export async function applyCommand(
  db: Database,
  input: CommandInput & {
    applicationId: string;
    actor: Actor;
    expectedSeq: number;
    idempotencyKey: string | null;
    meta?: RequestMeta;
  },
): Promise<{ event: ApplicationEventRow; replayed: boolean }> {
  const id = actorId(input.actor);

  return db.transaction(async (tx) => {
    const locked = await lockApplication(tx, input.applicationId);
    if (!locked) throw new NotFoundError("No such application.");
    const { application, schoolKey } = locked;
    await authorize(tx, input.actor, application.id, schoolKey);

    // The row is history the moment it commits, so it is checked before it is
    // written rather than when someone first tries to read it.
    const payload = COMMAND_PAYLOADS[input.command].parse(input.payload);

    if (input.idempotencyKey) {
      const earlier = await findEventByIdempotencyKey(
        tx,
        input.actor.type,
        id,
        input.idempotencyKey,
      );
      if (earlier) {
        // A retry repeats its request exactly. Anything else under the same key
        // is a different request, and returning the old event would hide it.
        if (
          earlier.applicationId !== application.id ||
          earlier.command !== input.command ||
          !isDeepStrictEqual(earlier.payload, payload)
        ) {
          throw reusedKey();
        }
        return { event: earlier, replayed: true };
      }
    }

    if (input.expectedSeq !== application.lastEventSeq) {
      throw new StaleSequenceError("This application changed since it was loaded.");
    }

    const result = transition(application.stage, input.command, input.actor.type);
    if (!result.ok) {
      if (result.refusal === "ACTOR_NOT_ALLOWED") throw new ForbiddenError("Not allowed.");
      throw new IllegalTransitionError(`${input.command} is not allowed at ${application.stage}.`);
    }

    const seq = application.lastEventSeq + 1;

    const event = await insertEvent(tx, {
      applicationId: application.id,
      seq,
      command: input.command,
      fromStage: application.stage,
      toStage: result.to,
      actorType: input.actor.type,
      actorId: id,
      familyVisible: result.familyVisible,
      payload,
      payloadVersion: payload.payloadVersion,
      idempotencyKey: input.idempotencyKey,
      ...input.meta,
    }).catch((error: unknown) => {
      // The same key on another application, sent at the same moment.
      if (isUniqueViolation(error)) throw reusedKey();
      throw error;
    });

    await recordEventOnApplication(tx, application.id, {
      stage: result.to,
      lastEventSeq: seq,
      stageChanged: result.to !== application.stage,
      interviewMode:
        input.command === "CHANGE_INTERVIEW_MODE"
          ? COMMAND_PAYLOADS.CHANGE_INTERVIEW_MODE.parse(payload).mode
          : undefined,
    });

    return { event, replayed: false };
  });
}

/**
 * Appends a new version of the family's form. `expectedVersion` is the
 * version the form was loaded from, so a save from an older view gets a
 * conflict. A retry of a save that already landed, same author and same data,
 * returns that version instead.
 */
export async function saveProfile(
  db: Database,
  input: {
    applicationId: string;
    userId: string;
    profile: ApplicantProfileInput;
    expectedVersion: number;
  },
): Promise<{ version: number; replayed: boolean }> {
  const profile = ApplicantProfile.parse(input.profile);

  return db.transaction(async (tx) => {
    const locked = await lockApplication(tx, input.applicationId);
    if (!locked) throw new NotFoundError("No such application.");
    const { application } = locked;
    if (!(await hasAccess(tx, application.id, input.userId))) {
      throw new NotFoundError("No such application.");
    }

    const latest = await findLatestProfileVersion(tx, application.id);
    const latestVersion = latest?.version ?? 0;

    if (input.expectedVersion !== latestVersion) {
      const landed = await findProfileVersion(tx, application.id, input.expectedVersion + 1);
      if (landed?.authorUserId === input.userId && isDeepStrictEqual(landed.data, profile)) {
        return { version: landed.version, replayed: true };
      }
      throw new StaleSequenceError("This form changed since it was loaded.");
    }

    // A finished application is a closed record. Which open stages still let
    // the family edit is the registration screen's call.
    if (isEndStage(application.stage)) {
      throw new IllegalTransitionError(`The form cannot change at ${application.stage}.`);
    }

    const version = latestVersion + 1;
    await insertProfileVersion(tx, {
      applicationId: application.id,
      version,
      data: profile,
      authorUserId: input.userId,
    });

    if (profile.nik !== application.nik) {
      await updateApplicationNik(tx, application.id, profile.nik).catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
        throw error;
      });
    }

    return { version, replayed: false };
  });
}

/**
 * The domain's own check, whatever the procedure already did. An application
 * the actor may not see is NOT_FOUND, so its existence never leaks. A
 * principal sees everything in its schools and changes nothing.
 */
async function authorize(tx: Transaction, actor: Actor, applicationId: string, schoolKey: string) {
  if (actor.type === "FAMILY") {
    if (!(await hasAccess(tx, applicationId, actor.userId))) {
      throw new NotFoundError("No such application.");
    }
  } else if (actor.type === "STAFF") {
    if (!(actor.staff.schoolKeys as readonly string[]).includes(schoolKey)) {
      throw new NotFoundError("No such application.");
    }
    if (actor.staff.role === "PRINCIPAL") throw new ForbiddenError("Not allowed.");
  }
}

function reusedKey() {
  return new ConflictError("This idempotency key was already used for another request.");
}
