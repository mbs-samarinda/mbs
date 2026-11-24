import { isDeepStrictEqual } from "node:util";

import {
  ApplicantProfile,
  AppliedCommand,
  COMMAND_PAYLOADS,
  FamilyCommand,
  type ActorType,
  type ApplicantProfileInput,
  type ApplicationCommand,
  type CommandPayload,
  type FamilyApplication,
  type FamilyApplicationSummary,
  type SchoolKey,
} from "@mbs/api-contract";
import type { Database, Transaction } from "@mbs/db";
import { CHILDREN_PER_ACCOUNT, isSchoolKey } from "@mbs/school-config";

import {
  ConflictError,
  DuplicateApplicationError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  IllegalTransitionError,
  isUniqueViolation,
  NotFoundError,
  RegistrationClosedError,
  StaleSequenceError,
  TooManyChildrenError,
} from "../../errors.ts";
import { findCycleById } from "../admission/repository.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { enqueueEventEmails, type OutboxSettings } from "../notification/outbox.ts";
import { formatRegistrationNumber } from "./registration-number.ts";
import {
  countOtherChildren,
  findApplicationById,
  findApplicationForUser,
  findEventByIdempotencyKey,
  findLatestProfileVersion,
  findNewestEventOf,
  findProfileVersion,
  grantAccess,
  hasAccess,
  insertApplication,
  insertEvent,
  insertProfileVersion,
  isNikTaken,
  listApplicationsForUser,
  listFamilyVisibleEvents,
  listPromisedDocuments,
  lockAccount,
  lockApplication,
  lockForSubmission,
  nextRegistrationSeq,
  recordEventOnApplication,
  snapshotDocumentRequirements,
  updateApplicationNik,
  type ApplicationEventRow,
  type ApplicationRow,
} from "./repository.ts";
import { familyStage, requiredCommand, transition, type NotificationKey } from "./stages.ts";

export async function listFamilyApplications(
  db: Database,
  family: { userId: string },
): Promise<FamilyApplicationSummary[]> {
  return (await listApplicationsForUser(db, family.userId)).map(toFamilySummary);
}

export async function loadFamilyApplication(
  db: Database,
  family: { userId: string },
  applicationId: string,
): Promise<FamilyApplication> {
  const found = await findApplicationForUser(db, applicationId, family.userId);
  if (!found) throw new NotFoundError("No such application.");

  const [cycle, documents, events] = await Promise.all([
    findCycleById(db, found.admissionCycleId),
    listPromisedDocuments(db, found.id, "REGISTRATION"),
    listFamilyVisibleEvents(db, found.id),
  ]);
  return {
    ...toFamilySummary(found),
    registrationFee: found.registrationFee,
    documents,
    resultPublishAt: cycle!.resultPublishAt.toISOString(),
    events: events.map(({ command, createdAt, actorType, payload }) => ({
      command: FamilyCommand.parse(command),
      at: createdAt.toISOString(),
      actor: actorType,
      reason: reasonForFamily(actorType, payload),
    })),
  };
}

function toFamilySummary({
  id,
  registrationNumber,
  schoolKey,
  childName,
  stage,
}: Awaited<ReturnType<typeof listApplicationsForUser>>[number]): FamilyApplicationSummary {
  if (!isSchoolKey(schoolKey)) throw new Error(`Unknown school ${schoolKey}.`);
  return { id, registrationNumber, schoolKey, childName, stage: familyStage(stage) };
}

/** A reason is for the family to read only when the committee gave it. */
function reasonForFamily(actorType: ActorType, payload: CommandPayload<ApplicationCommand>) {
  return actorType === "STAFF" && "reason" in payload ? (payload.reason ?? null) : null;
}

export type Actor =
  | { type: "FAMILY"; userId: string }
  | { type: "STAFF"; staff: StaffContext }
  | { type: "SYSTEM"; job: string };

export type RequestMeta = {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const KEY_REUSED_MESSAGE = "This idempotency key was already used for another request.";
const DUPLICATE_MESSAGE = "This child has already applied to this school in this cycle.";

function actorId(actor: Actor) {
  if (actor.type === "FAMILY") return actor.userId;
  if (actor.type === "STAFF") return actor.staff.id;
  return actor.job;
}

export async function submitApplication(
  db: Database,
  input: {
    cycleId: string;
    schoolKey: SchoolKey;
    userId: string;
    profile: ApplicantProfileInput;
    idempotencyKey: string | null;
    meta?: RequestMeta;
  },
  outbox: OutboxSettings,
): Promise<{ application: ApplicationRow; event: ApplicationEventRow; replayed: boolean }> {
  const profile = ApplicantProfile.parse(input.profile);

  return db.transaction(async (tx) => {
    // First and for every submit, so a key that is sent twice at once meets itself here.
    await lockAccount(tx, input.userId);
    const cycle = await lockForSubmission(tx, input.cycleId, input.schoolKey);
    if (!cycle) throw new NotFoundError("No such cycle.");

    if (input.idempotencyKey) {
      const earlier = await findEventByIdempotencyKey(
        tx,
        "FAMILY",
        input.userId,
        input.idempotencyKey,
      );
      if (earlier) {
        const application = await findApplicationById(tx, earlier.applicationId);
        const firstForm = await findProfileVersion(tx, earlier.applicationId, 1);
        if (
          earlier.command !== "SUBMIT" ||
          application?.admissionCycleId !== input.cycleId ||
          application.schoolId !== cycle.schoolId ||
          !sameAsStored(firstForm?.data, profile)
        ) {
          throw new IdempotencyKeyReusedError({
            applicationId: earlier.applicationId,
            sameRegistration:
              application?.admissionCycleId === input.cycleId &&
              application.schoolId === cycle.schoolId &&
              isSameChild(firstForm?.data, profile),
          });
        }
        return { application, event: earlier, replayed: true };
      }
    }

    if (cycle.status !== "OPEN" || !cycle.isEnabled || !cycle.inWindow) {
      throw new RegistrationClosedError("Registration is not open at this school.");
    }

    // Before the NIK, or an account at its limit could ask which NIKs are taken
    // and leave no trace.
    const others = await countOtherChildren(tx, {
      cycleId: input.cycleId,
      userId: input.userId,
      nik: profile.nik,
    });
    if (others >= CHILDREN_PER_ACCOUNT) {
      throw new TooManyChildrenError("This account registered all the children it may.");
    }

    if (await isNikTaken(tx, input.cycleId, cycle.schoolId, profile.nik)) {
      throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
    }

    const result = transition(null, "SUBMIT", "FAMILY");
    if (!result.ok) throw new IllegalTransitionError("SUBMIT is not allowed.");

    const seq = await nextRegistrationSeq(tx, input.cycleId, cycle.schoolId);
    const inserted = await insertApplication(tx, {
      admissionCycleId: input.cycleId,
      schoolId: cycle.schoolId,
      registrationSeq: seq,
      registrationNumber: formatRegistrationNumber(input.schoolKey, seq),
      stage: result.to,
      nik: profile.nik,
      registrationFee: cycle.feeOverride ?? cycle.defaultFee,
      lastEventSeq: 1,
      createdByUserId: input.userId,
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new DuplicateApplicationError(DUPLICATE_MESSAGE);
      throw error;
    });

    await snapshotDocumentRequirements(tx, inserted.id, input.cycleId, cycle.schoolId);
    await insertProfileVersion(tx, {
      applicationId: inserted.id,
      version: 1,
      data: profile,
      authorUserId: input.userId,
    });
    await grantAccess(tx, inserted.id, input.userId);
    const event = await insertEvent(tx, {
      applicationId: inserted.id,
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
    });
    const application = await recordEventOnApplication(tx, inserted.id, {
      eventId: event.id,
      stage: result.to,
      lastEventSeq: 1,
      stageChanged: true,
      interviewMode: undefined,
    });
    await notifyFamily(
      tx,
      result,
      { application, event, schoolKey: input.schoolKey, staffReason: null },
      outbox,
    );

    return { application, event, replayed: false };
  });
}

async function notifyFamily(
  tx: Transaction,
  result: { familyVisible: boolean; notification: NotificationKey | null },
  written: {
    application: ApplicationRow;
    event: ApplicationEventRow;
    schoolKey: string;
    staffReason: string | null;
  },
  outbox: OutboxSettings,
) {
  if (!result.familyVisible || !result.notification) return;
  if (!isSchoolKey(written.schoolKey)) throw new Error(`Unknown school ${written.schoolKey}.`);
  await enqueueEventEmails(tx, {
    applicationId: written.application.id,
    eventId: written.event.id,
    schoolKey: written.schoolKey,
    registrationNumber: written.application.registrationNumber,
    staffReason: written.staffReason,
    template: result.notification,
    settings: outbox,
  });
}

type CommandContext = {
  applicationId: string;
  actor: Actor;
  expectedSeq: number;
  idempotencyKey: string | null;
  meta?: RequestMeta;
};

export async function applyCommand(
  db: Database,
  input: CommandContext & { command: ApplicationCommand; payload: unknown },
  outbox: OutboxSettings,
): Promise<{ event: ApplicationEventRow; replayed: boolean }> {
  const command = AppliedCommand.parse(input.command);
  const payload = COMMAND_PAYLOADS[command].parse(input.payload);

  return runCommand(db, input, command, outbox, {
    isRetry: async (earlier) =>
      earlier.command === command && sameAsStored(earlier.payload, payload),
    write: async () => payload,
  });
}

export async function saveProfile(
  db: Database,
  input: CommandContext & { profile: ApplicantProfileInput },
  outbox: OutboxSettings,
): Promise<{ version: number; event: ApplicationEventRow; replayed: boolean }> {
  const profile = ApplicantProfile.parse(input.profile);
  const author = authorUserId(input.actor);

  const result = await runCommand(db, input, "EDIT_PROFILE", outbox, {
    isRetry: async (earlier, tx) => {
      if (earlier.command !== "EDIT_PROFILE") return false;
      const { version } = COMMAND_PAYLOADS.EDIT_PROFILE.parse(earlier.payload);
      const saved = await findProfileVersion(tx, earlier.applicationId, version);
      return saved?.authorUserId === author && sameAsStored(saved.data, profile);
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
 * A note says nothing about the application's state, so it has no stale check: a
 * note written while someone else moved the application on is still true.
 */
export async function addNote(
  db: Database,
  input: Omit<CommandContext, "expectedSeq" | "idempotencyKey"> & {
    note: string;
    idempotencyKey: string;
  },
  outbox: OutboxSettings,
): Promise<{ event: ApplicationEventRow; replayed: boolean }> {
  const payload = COMMAND_PAYLOADS.ADD_NOTE.parse({ payloadVersion: 1, note: input.note });
  return runCommand(db, { ...input, expectedSeq: null }, "ADD_NOTE", outbox, {
    isRetry: async (earlier) =>
      earlier.command === "ADD_NOTE" && sameAsStored(earlier.payload, payload),
    write: async () => payload,
  });
}

async function runCommand(
  db: Database,
  input: Omit<CommandContext, "expectedSeq"> & { expectedSeq: number | null },
  command: ApplicationCommand,
  outbox: OutboxSettings,
  steps: {
    isRetry: (earlier: ApplicationEventRow, tx: Transaction) => Promise<boolean>;
    write: (
      tx: Transaction,
      application: ApplicationRow,
    ) => Promise<CommandPayload<ApplicationCommand>>;
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
          throw new ConflictError(KEY_REUSED_MESSAGE);
        }
        return { event: earlier, replayed: true };
      }
    }

    if (input.expectedSeq !== null && input.expectedSeq !== application.lastEventSeq) {
      throw new StaleSequenceError("This application changed since it was loaded.");
    }

    const required = requiredCommand(command);
    const newest = required ? await findNewestEventOf(tx, application.id, required) : null;
    const result = transition(
      application.stage,
      command,
      input.actor.type,
      newest?.payload ?? null,
    );
    if (!result.ok) {
      if (result.refusal === "ACTOR_NOT_ALLOWED") throw new ForbiddenError("Not allowed.");
      if (result.refusal === "REQUIREMENT_UNMET") {
        throw new IllegalTransitionError(`${command} does not match the newest ${required}.`);
      }
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
      if (isUniqueViolation(error)) {
        throw new ConflictError(KEY_REUSED_MESSAGE);
      }
      throw error;
    });

    await recordEventOnApplication(tx, application.id, {
      eventId: event.id,
      stage: result.to,
      lastEventSeq: seq,
      stageChanged: result.to !== application.stage,
      interviewMode:
        command === "CHANGE_INTERVIEW_MODE"
          ? COMMAND_PAYLOADS.CHANGE_INTERVIEW_MODE.parse(payload).mode
          : undefined,
    });
    const staffReason = reasonForFamily(input.actor.type, payload);
    await notifyFamily(tx, result, { application, event, schoolKey, staffReason }, outbox);

    return { event, replayed: false };
  });
}

function authorUserId(actor: Actor) {
  if (actor.type === "FAMILY") return actor.userId;
  if (actor.type === "STAFF") return actor.staff.authUserId;
  throw new ForbiddenError("A system job does not edit a family's form.");
}

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

/** A corrected NIK is still the same child, or a family would register it twice. */
function isSameChild(stored: ApplicantProfile | undefined, form: ApplicantProfile) {
  if (!stored) return false;
  if (stored.nik === form.nik) return true;
  return (
    stored.birthDate === form.birthDate &&
    stored.childFullName.toLowerCase() === form.childFullName.toLowerCase()
  );
}

function sameAsStored(stored: unknown, value: unknown) {
  return isDeepStrictEqual(stored, JSON.parse(JSON.stringify(value)));
}
