import { schema, type Database } from "@mbs/db";
import { and, desc, eq, inArray } from "drizzle-orm";

/**
 * Reads the cycle a school is currently showing to the public.
 *
 * Only OPEN and CLOSED cycles qualify: a DRAFT is next year's cycle being
 * prepared and must not leak, and an ARCHIVED one is finished. Nothing stops a
 * school from having two qualifying cycles, so the newest registration window
 * wins rather than whichever row Postgres happens to return first.
 */
export async function findCurrentCycleForSchool(db: Database, schoolKey: string) {
  const rows = await db
    .select({
      id: schema.admissionCycles.id,
      name: schema.admissionCycles.name,
      status: schema.admissionCycles.status,
      registrationOpenAt: schema.admissionCycles.registrationOpenAt,
      registrationCloseAt: schema.admissionCycles.registrationCloseAt,
      resultPublishAt: schema.admissionCycles.resultPublishAt,
      defaultFee: schema.admissionCycles.defaultFee,
      feeOverride: schema.schoolAdmissionSettings.feeOverride,
      isEnabled: schema.schoolAdmissionSettings.isEnabled,
    })
    .from(schema.admissionCycles)
    .innerJoin(
      schema.schoolAdmissionSettings,
      eq(schema.schoolAdmissionSettings.admissionCycleId, schema.admissionCycles.id),
    )
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAdmissionSettings.schoolId))
    .where(
      and(
        eq(schema.schools.key, schoolKey),
        inArray(schema.admissionCycles.status, ["OPEN", "CLOSED"]),
      ),
    )
    .orderBy(desc(schema.admissionCycles.registrationOpenAt))
    .limit(1);

  return rows[0] ?? null;
}
