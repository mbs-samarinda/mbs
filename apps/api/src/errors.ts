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

/** The request is well formed but the business state refuses it. */
export class ConflictError extends Error {
  readonly code:
    | "CONFLICT"
    | "REGISTRATION_CLOSED"
    | "DUPLICATE_APPLICATION"
    | "IDEMPOTENCY_KEY_REUSED" = "CONFLICT";
}

export class IllegalTransitionError extends ConflictError {}

export class StaleSequenceError extends ConflictError {}

export class DuplicateApplicationError extends ConflictError {
  override readonly code = "DUPLICATE_APPLICATION";
}

export class RegistrationClosedError extends ConflictError {
  override readonly code = "REGISTRATION_CLOSED";
}

export class IdempotencyKeyReusedError extends ConflictError {
  override readonly code = "IDEMPOTENCY_KEY_REUSED";
  /** What the key was first used for, by the same actor. */
  readonly first: { applicationId: string; sameRegistration: boolean };

  constructor(first: { applicationId: string; sameRegistration: boolean }) {
    super("This idempotency key was already used for another request.");
    this.first = first;
  }
}

/** Postgres 23505. Drizzle wraps the driver error, so the code may sit on `cause`. */
export function isUniqueViolation(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}
