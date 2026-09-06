import { oc } from "@orpc/contract";
import { z } from "zod";
import { PublicAdmissionCycle, SchoolKey } from "./schemas.ts";

export * from "./schemas.ts";

/**
 * The public contract, organised by audience: public, applicant, staff, admin.
 * Only `public` carries a procedure so far; the other three are the agreed
 * shape and stay empty until their procedures are built.
 */
export const contract = {
  public: {
    admission: {
      getCurrentCycle: oc
        .input(z.object({ schoolKey: SchoolKey }))
        .output(PublicAdmissionCycle.nullable()),
    },
  },
  applicant: {},
  staff: {},
  admin: {},
};
