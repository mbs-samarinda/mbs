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
  readonly code = "CONFLICT";
}

// The application domain's conflicts. Each is a ConflictError, so the boundary
// maps them without knowing them; the names let callers and tests tell them
// apart.

/** The stage table has no row for this command at the application's stage. */
export class IllegalTransitionError extends ConflictError {}

/** The command was made against an older view of the application. */
export class StaleSequenceError extends ConflictError {}

/** This child already applied to this school in this cycle. */
export class DuplicateApplicationError extends ConflictError {}

/** The cycle is not taking registrations, or not at this school. */
export class RegistrationClosedError extends ConflictError {}

/** Postgres 23505. Drizzle wraps the driver error, so the code may sit on `cause`. */
export function isUniqueViolation(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}
