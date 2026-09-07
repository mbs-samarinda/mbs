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
