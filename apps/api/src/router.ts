import { getCurrentCycleProcedure } from "./modules/admission/procedures.ts";

/** Mirrors the contract. Audiences appear here as they get procedures. */
export const router = {
  public: {
    admission: {
      getCurrentCycle: getCurrentCycleProcedure,
    },
  },
};
