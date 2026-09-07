import { administratorProcedure, staffProcedure } from "../../plugins/orpc.ts";
import {
  createStaff,
  getStaffProfile,
  listStaffProfiles,
  setStaffActive,
  updateStaffAccess,
} from "./service.ts";

// Procedures stay thin: contract -> authorization -> domain operation.
// Authorization is the middleware behind `staffProcedure` and
// `administratorProcedure`, so nothing here checks a role by hand.
export const getMeProcedure = staffProcedure.staff.me.get.handler(({ context }) =>
  getStaffProfile(context.db, context.staff),
);

export const listStaffProcedure = administratorProcedure.admin.staff.list.handler(({ context }) =>
  listStaffProfiles(context.db, context.staff),
);

export const createStaffProcedure = administratorProcedure.admin.staff.create.handler(
  ({ input, context }) => createStaff(context.db, context.staff, input),
);

export const updateStaffProcedure = administratorProcedure.admin.staff.update.handler(
  ({ input, context }) => updateStaffAccess(context.db, context.staff, input),
);

export const setStaffActiveProcedure = administratorProcedure.admin.staff.setActive.handler(
  ({ input, context }) => setStaffActive(context.db, context.staff, input),
);
