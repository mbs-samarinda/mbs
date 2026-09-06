import { schema, type Database } from "@mbs/db";
import { and, eq, ne } from "drizzle-orm";

/** Reads the one non-archived cycle a school is joined to, if any. */
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
    .where(and(eq(schema.schools.key, schoolKey), ne(schema.admissionCycles.status, "ARCHIVED")))
    .limit(1);

  return rows[0] ?? null;
}
