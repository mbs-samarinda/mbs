import { contract } from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { implement, ORPCError } from "@orpc/server";

import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../errors.ts";
import { requireRole, resolveStaff, type SessionUser } from "../modules/auth/authorization.ts";

export type ApiContext = {
  db: Database;
  /** The Better Auth session user, already resolved for this request. */
  sessionUser: SessionUser | null;
};

// Not exported: a procedure built straight from this one skips the error
// translation below and turns every domain error into a 500. Build from
// publicProcedure, staffProcedure or administratorProcedure instead.
const os = implement(contract).$context<ApiContext>();

/**
 * The one place domain errors become transport errors. Services throw the small
 * classes in `../errors.ts`; nothing below this line knows about HTTP or oRPC.
 * Anything else is left alone and surfaces as a generic 500 with a request id.
 */
const translateErrors = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw new ORPCError(error.code, { message: error.message });
    }
    throw error;
  }
});

export const publicProcedure = os.use(translateErrors);

/** Proves the caller is an active, approved staff member before the handler runs. */
export const staffProcedure = publicProcedure.use(async ({ context, next }) =>
  next({ context: { staff: await resolveStaff(context.db, context.sessionUser) } }),
);

/** Everything under `admin` is administrator-only. Schools are still checked separately. */
export const administratorProcedure = staffProcedure.use(({ context, next }) => {
  requireRole(context.staff, "ADMINISTRATOR");
  return next();
});
