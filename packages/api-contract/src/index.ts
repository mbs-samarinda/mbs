import { oc } from "@orpc/contract";
import { z } from "zod";

import { PublicAdmissionCycle, SchoolKey } from "./schemas.ts";

export * from "./schemas.ts";

/**
 * The public contract, organised by audience. `applicant`, `staff` and `admin`
 * are the agreed namespaces and get added when they carry procedures.
 */
export const contract = {
  public: {
    admission: {
      getCurrentCycle: oc
        .input(z.object({ schoolKey: SchoolKey }))
        .output(PublicAdmissionCycle.nullable()),
    },
  },
};
