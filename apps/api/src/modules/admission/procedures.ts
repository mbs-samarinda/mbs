import { administratorProcedure, publicProcedure } from "../../plugins/orpc.ts";
import {
  createAdmissionCycle,
  getCurrentCycle,
  listAdmissionCycles,
  listSchoolAdmissionSettings,
  setAdmissionCycleStatus,
  updateAdmissionCycle,
  upsertSchoolAdmissionSetting,
} from "./service.ts";

// Procedures stay thin: contract -> authorization -> domain operation.
export const getCurrentCycleProcedure = publicProcedure.public.admission.getCurrentCycle.handler(
  ({ input, context }) => getCurrentCycle(context.db, input.schoolKey),
);

export const listCyclesProcedure = administratorProcedure.admin.cycles.list.handler(({ context }) =>
  listAdmissionCycles(context.db),
);

export const createCycleProcedure = administratorProcedure.admin.cycles.create.handler(
  ({ input, context }) => createAdmissionCycle(context.db, context.staff, input),
);

export const updateCycleProcedure = administratorProcedure.admin.cycles.update.handler(
  ({ input, context }) => updateAdmissionCycle(context.db, context.staff, input),
);

export const setCycleStatusProcedure = administratorProcedure.admin.cycles.setStatus.handler(
  ({ input, context }) => setAdmissionCycleStatus(context.db, context.staff, input),
);

export const listSchoolSettingsProcedure = administratorProcedure.admin.schoolSettings.list.handler(
  ({ input, context }) => listSchoolAdmissionSettings(context.db, context.staff, input),
);

export const upsertSchoolSettingProcedure =
  administratorProcedure.admin.schoolSettings.upsert.handler(({ input, context }) =>
    upsertSchoolAdmissionSetting(context.db, context.staff, input),
  );
