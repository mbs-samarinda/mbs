import type { SetupGap } from "@mbs/api-contract";

/**
 * Transport-independent domain errors. Services throw these; the oRPC boundary
 * turns them into declared codes. Domain code never throws ORPCError, an HTTP
 * response, or a raw database error.
 */
export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

/** No application has this number and NIK together. Says nothing about either alone. */
export class NoMatchError extends Error {
  readonly code = "NO_MATCH";
}

export class TooManyTriesError extends Error {
  readonly code = "TOO_MANY_TRIES";
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many tries.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The request is well formed but the business state refuses it. */
export class ConflictError extends Error {
  readonly code:
    | "CONFLICT"
    | "REGISTRATION_CLOSED"
    | "DUPLICATE_APPLICATION"
    | "TOO_MANY_CHILDREN"
    | "IDEMPOTENCY_KEY_REUSED"
    | "NOT_READY"
    | "ANOTHER_CYCLE_OPEN"
    | "EMAIL_TAKEN"
    | "LAST_ADMINISTRATOR"
    | "UPLOAD_INCOMPLETE"
    | "ALREADY_HANDLED" = "CONFLICT";
  /** What the screen needs to explain the refusal, in the shape the contract declares. */
  readonly data: unknown = undefined;
}

export class NotReadyError extends ConflictError {
  override readonly code = "NOT_READY";
  override readonly data: { gaps: SetupGap[] };

  constructor(gaps: SetupGap[]) {
    super("The cycle is not ready to open.");
    this.data = { gaps };
  }
}

export class AnotherCycleOpenError extends ConflictError {
  override readonly code = "ANOTHER_CYCLE_OPEN";
}

export class EmailTakenError extends ConflictError {
  override readonly code = "EMAIL_TAKEN";
  override readonly data: { email: string };

  constructor(email: string) {
    super("That address already has a profile.");
    this.data = { email };
  }
}

export class LastAdministratorError extends ConflictError {
  override readonly code = "LAST_ADMINISTRATOR";
}

export class UploadIncompleteError extends ConflictError {
  override readonly code = "UPLOAD_INCOMPLETE";
}

export class AlreadyHandledError extends ConflictError {
  override readonly code = "ALREADY_HANDLED";
}

export class IllegalTransitionError extends ConflictError {}

export class StaleSequenceError extends ConflictError {}

export class DuplicateApplicationError extends ConflictError {
  override readonly code = "DUPLICATE_APPLICATION";
}

export class TooManyChildrenError extends ConflictError {
  override readonly code = "TOO_MANY_CHILDREN";
}

export class RegistrationClosedError extends ConflictError {
  override readonly code = "REGISTRATION_CLOSED";
}

export class IdempotencyKeyReusedError extends ConflictError {
  override readonly code = "IDEMPOTENCY_KEY_REUSED";
  /** What the key was first used for, by the same actor. */
  override readonly data: { applicationId: string; sameRegistration: boolean };

  constructor(first: { applicationId: string; sameRegistration: boolean }) {
    super("This idempotency key was already used for another request.");
    this.data = first;
  }
}

/** Postgres 23505. Drizzle wraps the driver error, so the code may sit on `cause`. */
export function isUniqueViolation(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}
