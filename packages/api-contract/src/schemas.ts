import { SCHOOL_KEYS } from "@mbs/school-config";
import { z } from "zod";

/** The school list lives in @mbs/school-config; this is the same list as Zod. */
export const SchoolKey = z.enum(SCHOOL_KEYS);
export type SchoolKey = z.infer<typeof SchoolKey>;

export const CycleStatus = z.enum(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"]);
export type CycleStatus = z.infer<typeof CycleStatus>;

/**
 * The cycle is global across MBSS and carries no school. A school is enabled
 * for it and may override the fee, so the public view is resolved per school:
 * effective fee is `feeOverride ?? defaultFee`.
 */
export const PublicAdmissionCycle = z.object({
  id: z.uuid(),
  name: z.string(),
  status: CycleStatus,
  registrationOpenAt: z.iso.datetime(),
  registrationCloseAt: z.iso.datetime(),
  resultPublishAt: z.iso.datetime(),
  schoolKey: SchoolKey,
  isEnabled: z.boolean(),
  effectiveFee: z.int().nonnegative(),
});
export type PublicAdmissionCycle = z.infer<typeof PublicAdmissionCycle>;

export const StaffRole = z.enum(["ADMINISTRATOR", "STAFF", "PRINCIPAL"]);
export type StaffRole = z.infer<typeof StaffRole>;

export const StaffLoginEmailKind = z.enum(["INSTITUTIONAL", "PERSONAL"]);
export type StaffLoginEmailKind = z.infer<typeof StaffLoginEmailKind>;

/** `bound` is whether a first sign-in has claimed this address. */
export const StaffLoginEmail = z.object({
  email: z.email(),
  kind: StaffLoginEmailKind,
  bound: z.boolean(),
});
export type StaffLoginEmail = z.infer<typeof StaffLoginEmail>;

/**
 * The signed-in staff member's own identity. `schools` may be empty: a profile
 * with no school assigned is a real state the interface has to show, not a bug.
 */
export const StaffProfile = z.object({
  id: z.uuid(),
  name: z.string(),
  role: StaffRole,
  schools: z.array(SchoolKey),
  loginEmails: z.array(StaffLoginEmail),
});
export type StaffProfile = z.infer<typeof StaffProfile>;

export const StaffSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  role: StaffRole,
  isActive: z.boolean(),
  schools: z.array(SchoolKey),
  loginEmails: z.array(StaffLoginEmail),
});
export type StaffSummary = z.infer<typeof StaffSummary>;

/** A set, not a list: repeating a key would collide on staff_school_access. */
const SchoolKeys = z
  .array(SchoolKey)
  .min(1)
  .refine((keys) => new Set(keys).size === keys.length, "Sekolah tidak boleh diulang.");

export const CreateStaffInput = z.object({
  name: z.string().trim().min(1).max(120),
  // The institutional-domain rule is business policy, so the service owns it.
  email: z.email(),
  role: StaffRole,
  schools: SchoolKeys,
});
export type CreateStaffInput = z.infer<typeof CreateStaffInput>;

export const UpdateStaffInput = z.object({
  staffId: z.uuid(),
  role: StaffRole,
  schools: SchoolKeys,
});
export type UpdateStaffInput = z.infer<typeof UpdateStaffInput>;

export const SetStaffActiveInput = z.object({
  staffId: z.uuid(),
  isActive: z.boolean(),
});
export type SetStaffActiveInput = z.infer<typeof SetStaffActiveInput>;
