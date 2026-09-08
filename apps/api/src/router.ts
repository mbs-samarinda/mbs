import {
  createCycleProcedure,
  getCurrentCycleProcedure,
  listCyclesProcedure,
  listSchoolSettingsProcedure,
  setCycleStatusProcedure,
  updateCycleProcedure,
  upsertSchoolSettingProcedure,
} from "./modules/admission/procedures.ts";
import {
  createStaffProcedure,
  getMeProcedure,
  listStaffProcedure,
  setStaffActiveProcedure,
  updateStaffProcedure,
} from "./modules/staff/procedures.ts";

/** Mirrors the contract. Audiences appear here as they get procedures. */
export const router = {
  public: {
    admission: {
      getCurrentCycle: getCurrentCycleProcedure,
    },
  },
  staff: {
    me: {
      get: getMeProcedure,
    },
  },
  admin: {
    cycles: {
      list: listCyclesProcedure,
      create: createCycleProcedure,
      update: updateCycleProcedure,
      setStatus: setCycleStatusProcedure,
    },
    schoolSettings: {
      list: listSchoolSettingsProcedure,
      upsert: upsertSchoolSettingProcedure,
    },
    staff: {
      list: listStaffProcedure,
      create: createStaffProcedure,
      update: updateStaffProcedure,
      setActive: setStaffActiveProcedure,
    },
  },
};
