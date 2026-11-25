import {
  CYCLE_STATUSES,
  DOCUMENT_STAGES,
  DOCUMENT_TYPES,
  SCHOOL_KEYS,
  STAFF_LOGIN_EMAIL_KINDS,
  STAFF_ROLES,
} from "@mbs/school-config";
import { z } from "zod";

/** The school list lives in @mbs/school-config; this is the same list as Zod. */
export const SchoolKey = z.enum(SCHOOL_KEYS);
export type SchoolKey = z.infer<typeof SchoolKey>;

export const CycleStatus = z.enum(CYCLE_STATUSES);
export type CycleStatus = z.infer<typeof CycleStatus>;

export const DocumentType = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentType>;

export const DocumentStage = z.enum(DOCUMENT_STAGES);
export type DocumentStage = z.infer<typeof DocumentStage>;

/** An absent type is one the school does not collect; `required` false is optional. */
export const DocumentRequirement = z.object({ type: DocumentType, required: z.boolean() });
export type DocumentRequirement = z.infer<typeof DocumentRequirement>;

/**
 * The cycle is global across MBSS and carries no school. A school is enabled
 * for it and may override the fee, so the public view is resolved per school:
 * effective fee is `feeOverride ?? defaultFee`.
 *
 * `documents` is here rather than only on the committee's `SchoolAdmissionSetting`
 * because the school's `/pendaftaran` page has to print what a family must bring,
 * and the page map makes that an authoritative fact an editor cannot restate. It
 * carries no instructions text: that is written for one decided application, not
 * for a public page.
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
  documents: z.array(DocumentRequirement),
});
export type PublicAdmissionCycle = z.infer<typeof PublicAdmissionCycle>;

/**
 * Where families transfer the fee. One account for every school, per cycle.
 * All three parts or none, so a half-filled account is never shown to a family.
 */
export const BankAccount = z.object({
  bankName: z.string().trim().min(1).max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9][0-9 .-]{3,38}[0-9]$/, "Nomor rekening hanya angka."),
  accountHolder: z.string().trim().min(1).max(120),
});
export type BankAccount = z.infer<typeof BankAccount>;

/** The committee's view of a cycle. Global across MBSS, so it carries no school. */
export const AdmissionCycle = z.object({
  id: z.uuid(),
  name: z.string(),
  status: CycleStatus,
  registrationOpenAt: z.iso.datetime(),
  registrationCloseAt: z.iso.datetime(),
  resultPublishAt: z.iso.datetime(),
  defaultFee: z.int().nonnegative(),
  bank: BankAccount.nullable(),
});
export type AdmissionCycle = z.infer<typeof AdmissionCycle>;

/**
 * Rupiah, whole. Zero is a legitimate fee for a cycle that charges nothing.
 * The ceiling is the `integer` column's, not a business rule: without it an
 * oversized amount passes validation and fails in Postgres, which surfaces as
 * an opaque 500 rather than a rejected field.
 */
export const Rupiah = z.int().nonnegative().max(2_147_483_647);

export const CycleName = z.string().trim().min(1).max(120);

export const Schedule = z.object({
  registrationOpenAt: z.iso.datetime(),
  registrationCloseAt: z.iso.datetime(),
  resultPublishAt: z.iso.datetime(),
});

/**
 * Registration opens before it closes, and results come after it closes.
 * Checked here because it is a property of the three values together, and the
 * path puts the message under the field the committee has to change.
 */
export const orderedDates = (value: z.infer<typeof Schedule>, ctx: z.RefinementCtx) => {
  const openAt = Date.parse(value.registrationOpenAt);
  const closeAt = Date.parse(value.registrationCloseAt);
  const publishAt = Date.parse(value.resultPublishAt);

  if (openAt >= closeAt) {
    ctx.addIssue({
      code: "custom",
      path: ["registrationCloseAt"],
      message: "Penutupan harus setelah pembukaan.",
    });
  }
  if (closeAt >= publishAt) {
    ctx.addIssue({
      code: "custom",
      path: ["resultPublishAt"],
      message: "Pengumuman harus setelah penutupan.",
    });
  }
};

/** A new cycle copies everything else from the newest one, so only these are asked. */
export const CreateCycleInput = Schedule.extend({
  name: CycleName,
  defaultFee: Rupiah,
}).superRefine(orderedDates);
export type CreateCycleInput = z.infer<typeof CreateCycleInput>;

export const SetCycleStatusInput = z.object({ cycleId: z.uuid(), status: CycleStatus });
export type SetCycleStatusInput = z.infer<typeof SetCycleStatusInput>;

export const CycleRef = z.object({ cycleId: z.uuid() });
export type CycleRef = z.infer<typeof CycleRef>;

export const StaffRole = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRole>;

export const StaffLoginEmailKind = z.enum(STAFF_LOGIN_EMAIL_KINDS);
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
  lastSignInAt: z.iso.datetime().nullable(),
});
export type StaffSummary = z.infer<typeof StaffSummary>;

/** A set, not a list: repeating a key would collide on staff_school_access. */
const SchoolKeys = z
  .array(SchoolKey)
  .min(1)
  .refine((keys) => new Set(keys).size === keys.length, "Sekolah tidak boleh diulang.");

/**
 * The addresses that may sign in as one profile. At least one, or the profile
 * could never sign in again. The institutional-domain rule is business policy,
 * so the service owns it.
 */
const LoginEmails = z
  .array(z.string().trim().toLowerCase().pipe(z.email()))
  .min(1)
  .max(5)
  .refine((emails) => new Set(emails).size === emails.length, "Email tidak boleh diulang.");

const StaffFields = z.object({
  name: z.string().trim().min(1).max(120),
  emails: LoginEmails,
  role: StaffRole,
  schools: SchoolKeys,
});

export const CreateStaffInput = StaffFields;
export type CreateStaffInput = z.infer<typeof CreateStaffInput>;

export const UpdateStaffInput = StaffFields.extend({ staffId: z.uuid() });
export type UpdateStaffInput = z.infer<typeof UpdateStaffInput>;

export const SetStaffActiveInput = z.object({
  staffId: z.uuid(),
  isActive: z.boolean(),
});
export type SetStaffActiveInput = z.infer<typeof SetStaffActiveInput>;

/** The address another profile already holds, so the form can point at it. */
export const EmailTaken = z.object({ email: z.string() });
