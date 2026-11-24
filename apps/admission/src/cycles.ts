import type { PublicAdmissionCycle } from "@mbs/api-contract";
import { SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api.ts";

export type SchoolCycle = { schoolKey: SchoolKey; cycle: PublicAdmissionCycle | null };

export const cyclesQuery = queryOptions({
  queryKey: ["cycles"],
  queryFn: () =>
    Promise.all(
      SCHOOL_KEYS.map(async (schoolKey): Promise<SchoolCycle> => ({
        schoolKey,
        cycle: await api.public.admission.getCurrentCycle({ schoolKey }),
      })),
    ),
});

type Open = SchoolCycle & { cycle: PublicAdmissionCycle };

/** The schools by what a family can do there now. Not shown to them is permission. */
export function sortByPhase(schools: readonly SchoolCycle[], now: Date) {
  const phases: Record<"none" | "soon" | "open" | "closed", Open[]> = {
    none: [],
    soon: [],
    open: [],
    closed: [],
  };
  for (const { schoolKey, cycle } of schools) {
    if (cycle) phases[phaseOf(cycle, now)].push({ schoolKey, cycle });
  }
  return phases;
}

function phaseOf(cycle: PublicAdmissionCycle, now: Date) {
  const time = now.getTime();
  if (!cycle.isEnabled) return "none";
  if (cycle.status !== "OPEN" || time >= Date.parse(cycle.registrationCloseAt)) return "closed";
  return time < Date.parse(cycle.registrationOpenAt) ? "soon" : "open";
}
