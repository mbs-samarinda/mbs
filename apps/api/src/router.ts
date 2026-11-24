import {
  createCycleProcedure,
  getCurrentCycleProcedure,
  getCycleProcedure,
  listAgreementVersionsProcedure,
  listCyclesProcedure,
  saveCycleProcedure,
  setCycleStatusProcedure,
} from "./modules/admission/procedures.ts";
import {
  addNoteProcedure,
  checkStatusProcedure,
  getCommitteeApplicationProcedure,
  getDashboardProcedure,
  listCommitteeApplicationsProcedure,
  recordViewProcedure,
  getFamilyApplicationProcedure,
  listFamilyApplicationsProcedure,
  submitApplicationProcedure,
} from "./modules/application/procedures.ts";
import {
  createStaffProcedure,
  getMeProcedure,
  listStaffProcedure,
  setStaffActiveProcedure,
  updateStaffProcedure,
} from "./modules/staff/procedures.ts";

/** Mirrors the contract, as far as every host serves it. */
export const router = {
  public: {
    admission: {
      getCurrentCycle: getCurrentCycleProcedure,
    },
  },
  applicant: {
    applications: {
      list: listFamilyApplicationsProcedure,
      get: getFamilyApplicationProcedure,
      submit: submitApplicationProcedure,
    },
  },
  staff: {
    me: {
      get: getMeProcedure,
    },
    dashboard: {
      get: getDashboardProcedure,
    },
    applications: {
      list: listCommitteeApplicationsProcedure,
      get: getCommitteeApplicationProcedure,
      recordView: recordViewProcedure,
      addNote: addNoteProcedure,
    },
  },
  admin: {
    cycles: {
      list: listCyclesProcedure,
      get: getCycleProcedure,
      create: createCycleProcedure,
      save: saveCycleProcedure,
      setStatus: setCycleStatusProcedure,
    },
    agreements: {
      list: listAgreementVersionsProcedure,
    },
    staff: {
      list: listStaffProcedure,
      create: createStaffProcedure,
      update: updateStaffProcedure,
      setActive: setStaffActiveProcedure,
    },
  },
};

/** The parent app's host serves everything, the lookup without an account included. */
export const familyRouter = {
  ...router,
  public: {
    ...router.public,
    application: {
      checkStatus: checkStatusProcedure,
    },
  },
};
