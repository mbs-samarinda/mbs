import { isDeepStrictEqual } from "node:util";

import {
  ApplicantProfile,
  AppliedCommand,
  COMMAND_PAYLOADS,
  type ApplicantProfileInput,
  type ApplicationCommand,
  type CommandPayload,
  type SchoolKey,
} from "@mbs/api-contract";
import type { Database, Transaction } from "@mbs/db";
import { isSchoolKey } from "@mbs/school-config";

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
import { enqueueEventEmails, type OutboxSettings } from "../notification/outbox.ts";
import {
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
  lockApplication,
  lockForSubmission,
  nextRegistrationSeq,
  recordEventOnApplication,
  snapshotDocumentRequirements,
  updateApplicationNik,
  type ApplicationEventRow,
  type ApplicationRow,
} from "./repository.ts";
import { requiredCommand, transition, type NotificationKey } from "./stages.ts";

export async function loadFamilyApplication(
  db: Database,
  family: { userId: string },
  applicationId: string,
) {
  const found = await findApplicationForUser(db, applicationId, family.userId);
  if (!found || !isSchoolKey(found.schoolKey)) throw new NotFoundError("No such application.");
  return { ...found.application, schoolKey: found.schoolKey };
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
          throw reusedKey();
        }
        return { application, event: earlier, replayed: true };
      }
    }

    if (cycle.status !== "OPEN" || !cycle.isEnabled || !cycle.inWindow) {
      throw new RegistrationClosedError("Registration is not open at this school.");
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
      registrationNumber: `${input.schoolKey.toUpperCase()}-${String(seq).padStart(4, "0")}`,
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
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw reusedKey();
      throw error;
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

async function runCommand(
  db: Database,
  input: CommandContext,
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
          throw reusedKey();
        }
        return { event: earlier, replayed: true };
      }
    }

    if (input.expectedSeq !== application.lastEventSeq) {
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
      if (isUniqueViolation(error)) throw reusedKey();
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
    const staffReason =
      input.actor.type === "STAFF" && "reason" in payload ? (payload.reason ?? null) : null;
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

function sameAsStored(stored: unknown, value: unknown) {
  return isDeepStrictEqual(stored, JSON.parse(JSON.stringify(value)));
}

function reusedKey() {
  return new ConflictError("This idempotency key was already used for another request.");
}
