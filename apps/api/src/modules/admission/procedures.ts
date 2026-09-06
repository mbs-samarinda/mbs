import { os } from "../../plugins/orpc.ts";
import { getCurrentCycle } from "./service.ts";

// Procedures stay thin: contract -> authorization -> domain operation.
export const getCurrentCycleProcedure = os.public.admission.getCurrentCycle.handler(
  ({ input, context }) => getCurrentCycle(context.db, input.schoolKey),
);
