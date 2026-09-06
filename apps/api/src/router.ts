import { getCurrentCycleProcedure } from "./modules/admission/procedures.ts";

/**
 * The server router mirrors the contract's audience shape. `applicant`,
 * `staff` and `admin` are agreed namespaces with no procedures yet.
 */
export const router = {
  public: {
    admission: {
      getCurrentCycle: getCurrentCycleProcedure,
    },
  },
  applicant: {},
  staff: {},
  admin: {},
};
