import type { PublicAdmissionCycle, SchoolKey } from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { findCurrentCycleForSchool } from "./repository.ts";

/**
 * The public view of the current cycle for one school. The cycle itself is
 * global; the fee and the enabled flag come from the school's settings row.
 */
export async function getCurrentCycle(
  db: Database,
  schoolKey: SchoolKey,
): Promise<PublicAdmissionCycle | null> {
  const row = await findCurrentCycleForSchool(db, schoolKey);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    registrationOpenAt: row.registrationOpenAt.toISOString(),
    registrationCloseAt: row.registrationCloseAt.toISOString(),
    resultPublishAt: row.resultPublishAt.toISOString(),
    schoolKey,
    isEnabled: row.isEnabled,
    effectiveFee: row.feeOverride ?? row.defaultFee,
  };
}
