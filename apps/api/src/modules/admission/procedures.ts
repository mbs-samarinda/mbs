import { administratorProcedure, publicProcedure } from "../../plugins/orpc.ts";
import {
  createAdmissionCycle,
  getCurrentCycle,
  getCycleSetup,
  listAdmissionCycles,
  listSchoolAgreementVersions,
  saveCycleSection,
  setAdmissionCycleStatus,
} from "./service.ts";

// Procedures stay thin: contract -> authorization -> domain operation.
export const getCurrentCycleProcedure = publicProcedure.public.admission.getCurrentCycle.handler(
  ({ input, context }) => getCurrentCycle(context.db, input.schoolKey),
);

export const listCyclesProcedure = administratorProcedure.admin.cycles.list.handler(({ context }) =>
  listAdmissionCycles(context.db),
);

export const getCycleProcedure = administratorProcedure.admin.cycles.get.handler(
  ({ input, context }) => getCycleSetup(context.db, context.staff, input),
);

export const createCycleProcedure = administratorProcedure.admin.cycles.create.handler(
  ({ input, context }) => createAdmissionCycle(context.db, context.staff, input),
);

export const saveCycleProcedure = administratorProcedure.admin.cycles.save.handler(
  ({ input, context }) => saveCycleSection(context.db, context.staff, input),
);

export const setCycleStatusProcedure = administratorProcedure.admin.cycles.setStatus.handler(
  ({ input, context }) => setAdmissionCycleStatus(context.db, context.staff, input),
);

export const listAgreementVersionsProcedure = administratorProcedure.admin.agreements.list.handler(
  ({ input, context }) => listSchoolAgreementVersions(context.db, context.staff, input),
);
