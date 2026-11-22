import { isDeepStrictEqual } from "node:util";

import {
  ApplicantProfile,
  COMMAND_PAYLOADS,
  type ApplicantProfileInput,
  type ApplicationCommand,
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
import { transition } from "./stages.ts";

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

/** What every command on an existing application carries. */
type CommandContext = {
  applicationId: string;
  actor: Actor;
  expectedSeq: number;
  idempotencyKey: string | null;
  meta?: RequestMeta;
};

/**
 * Runs one command on an application through the stage table. In one
 * transaction it locks the application, replays an idempotency key the actor
 * already used, checks `expectedSeq` against the newest event, appends the
 * event and moves the application.
 */
export async function applyCommand(
  db: Database,
  input: CommandInput & CommandContext,
): Promise<{ event: ApplicationEventRow; replayed: boolean }> {
  // The type already leaves it out. This holds for callers that cast, such as
  // the simulator: an EDIT_PROFILE event with no profile version behind it
  // would be a lie in the timeline.
  if ((input.command as ApplicationCommand) === "EDIT_PROFILE") {
    throw new IllegalTransitionError("A profile edit goes through saveProfile.");
  }
  // The row is history the moment it commits, so it is checked before it is
  // written rather than when someone first tries to read it.
  const payload = COMMAND_PAYLOADS[input.command].parse(input.payload);

  return runCommand(db, input, input.command, {
    // A retry repeats its request exactly. Anything else under the same key is
    // a different request, and returning the old event would hide it.
    isRetry: async (earlier) =>
      earlier.command === input.command && isDeepStrictEqual(earlier.payload, payload),
    write: async () => payload,
  });
}

/**
 * Appends a new version of the family's form and an EDIT_PROFILE event in one
 * transaction, through the same checks as every other command. A retry with
 * the same key and the same form returns the version it first wrote.
 */
export async function saveProfile(
  db: Database,
  input: CommandContext & { profile: ApplicantProfileInput },
): Promise<{ version: number; event: ApplicationEventRow; replayed: boolean }> {
  const profile = ApplicantProfile.parse(input.profile);
  const author = authorUserId(input.actor);

  const result = await runCommand(db, input, "EDIT_PROFILE", {
    // The payload holds a version number chosen at write time, so a retry is
    // matched on the form it saved, not on the payload.
    isRetry: async (earlier, tx) => {
      if (earlier.command !== "EDIT_PROFILE") return false;
      const { version } = COMMAND_PAYLOADS.EDIT_PROFILE.parse(earlier.payload);
      const saved = await findProfileVersion(tx, earlier.applicationId, version);
      return saved?.authorUserId === author && isDeepStrictEqual(saved.data, profile);
    },
    write: async (tx, application) => {
      const latest = await findLatestProfileVersion(tx, application.id);
      const version = (latest?.version ?? 0) + 1;
      await insertProfileVersion(tx, {
        applicationId: application.id,
        version,
        data: profile,
        authorUserId: author,
      });
      if (profile.nik !== application.nik) {
        await updateApplicationNik(tx, application.id, profile.nik).catch((error: unknown) => {
          if (isUniqueViolation(error)) throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
          throw error;
        });
      }
      return COMMAND_PAYLOADS.EDIT_PROFILE.parse({ payloadVersion: 1, version });
    },
  });

  const { version } = COMMAND_PAYLOADS.EDIT_PROFILE.parse(result.event.payload);
  return { version, ...result };
}

/**
 * The one path every command on an existing application takes. `isRetry`
 * says whether an earlier event under the same key is this same request.
 * `write` runs once the command is allowed, writes anything the command owns
 * besides the event, and returns the event's payload.
 */
async function runCommand(
  db: Database,
  input: CommandContext,
  command: ApplicationCommand,
  steps: {
    isRetry: (earlier: ApplicationEventRow, tx: Transaction) => Promise<boolean>;
    write: (tx: Transaction, application: ApplicationRow) => Promise<{ payloadVersion: number }>;
  },
): Promise<{ event: ApplicationEventRow; replayed: boolean }> {
  const id = actorId(input.actor);

  return db.transaction(async (tx) => {
    const locked = await lockApplication(tx, input.applicationId);
    if (!locked) throw new NotFoundError("No such application.");
    const { application, schoolKey } = locked;
    await authorize(tx, input.actor, application.id, schoolKey);

    if (input.idempotencyKey) {
      const earlier = await findEventByIdempotencyKey(
        tx,
        input.actor.type,
        id,
        input.idempotencyKey,
      );
      if (earlier) {
        if (earlier.applicationId !== application.id || !(await steps.isRetry(earlier, tx))) {
          throw reusedKey();
        }
        return { event: earlier, replayed: true };
      }
    }

    if (input.expectedSeq !== application.lastEventSeq) {
      throw new StaleSequenceError("This application changed since it was loaded.");
    }

    const result = transition(application.stage, command, input.actor.type);
    if (!result.ok) {
      if (result.refusal === "ACTOR_NOT_ALLOWED") throw new ForbiddenError("Not allowed.");
      throw new IllegalTransitionError(`${command} is not allowed at ${application.stage}.`);
    }

    const payload = await steps.write(tx, application);
    const seq = application.lastEventSeq + 1;

    const event = await insertEvent(tx, {
      applicationId: application.id,
      seq,
      command,
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
        command === "CHANGE_INTERVIEW_MODE"
          ? COMMAND_PAYLOADS.CHANGE_INTERVIEW_MODE.parse(payload).mode
          : undefined,
    });

    return { event, replayed: false };
  });
}

/** The Better Auth user a profile version is written by. */
function authorUserId(actor: Actor) {
  if (actor.type === "FAMILY") return actor.userId;
  if (actor.type === "STAFF") return actor.staff.authUserId;
  throw new ForbiddenError("A system job does not edit a family's form.");
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
