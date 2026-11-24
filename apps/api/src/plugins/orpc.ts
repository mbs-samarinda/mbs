import { contract } from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { implement, ORPCError } from "@orpc/server";
import type { FastifyBaseLogger } from "fastify";

import {
  ConflictError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  NoMatchError,
  NotFoundError,
  TooManyTriesError,
  UnauthorizedError,
} from "../errors.ts";
import type { RequestMeta } from "../modules/application/service.ts";
import type { Audience } from "../modules/auth/auth.ts";
import { requireRole, resolveStaff, type SessionUser } from "../modules/auth/authorization.ts";
import type { OutboxSettings } from "../modules/notification/outbox.ts";

export type Session = { audience: Audience; user: SessionUser } | { audience: null };

export type ApiContext = {
  db: Database;
  session: Session;
  /** This request's logger, so a log line carries the request id. */
  log: FastifyBaseLogger;
  meta: RequestMeta;
  outbox: OutboxSettings;
};

// Not exported: a procedure built straight from this one skips the error
// translation below and turns every domain error into a 500. Build from
// publicProcedure, staffProcedure or administratorProcedure instead.
const os = implement(contract).$context<ApiContext>();

/**
 * The one place domain errors become transport errors. Services throw the small
 * classes in `../errors.ts`; nothing below this line knows about HTTP or oRPC.
 * Anything else passes through as a generic 500; `../app.ts` logs it.
 */
const translateErrors = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // The status is named because oRPC gives a code it does not know a 500.
    if (error instanceof ConflictError) {
      throw new ORPCError(error.code, {
        status: 409,
        message: error.message,
        data: error instanceof IdempotencyKeyReusedError ? error.first : undefined,
      });
    }
    if (error instanceof NoMatchError) {
      throw new ORPCError(error.code, { status: 404, message: error.message });
    }
    if (error instanceof TooManyTriesError) {
      throw new ORPCError(error.code, {
        status: 429,
        message: error.message,
        data: { retryAfterSeconds: error.retryAfterSeconds },
      });
    }
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError
    ) {
      throw new ORPCError(error.code, { message: error.message });
    }
    throw error;
  }
});

export const publicProcedure = os.use(translateErrors);

/** Proves the caller is an active, approved staff member before the handler runs. */
export const staffProcedure = publicProcedure.use(async ({ context, next }) =>
  next({
    context: {
      staff: await resolveStaff(
        context.db,
        context.session.audience === "STAFF" ? context.session.user : null,
      ),
    },
  }),
);

export const familyProcedure = publicProcedure.use(async ({ context, next }) => {
  if (context.session.audience !== "FAMILY") throw new UnauthorizedError("Not signed in.");
  return next({ context: { family: { userId: context.session.user.id } } });
});

/** Everything under `admin` is administrator-only. Schools are still checked separately. */
export const administratorProcedure = staffProcedure.use(({ context, next }) => {
  requireRole(context.staff, "ADMINISTRATOR");
  return next();
});
