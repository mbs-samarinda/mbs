import { z } from "zod";

import {
  AdmissionCycle,
  BankAccount,
  CycleName,
  DocumentRequirement,
  orderedDates,
  Rupiah,
  Schedule,
  SchoolKey,
} from "./schemas.ts";

/** The parts of a cycle the committee sets up, one side panel each. */
export const CYCLE_SECTIONS = [
  "schedule",
  "bank",
  "fees",
  "documents",
  "messages",
  "agreement",
] as const;
export const CycleSection = z.enum(CYCLE_SECTIONS);
export type CycleSection = z.infer<typeof CycleSection>;

/**
 * Everything a cycle can lack, and whether it stops registration from opening.
 * The rest can wait: a school usually sets the registrasi ulang fee, documents,
 * messages and agreement after registration opens, because applications copy
 * them only when results are published.
 */
export const SETUP_GAP_KINDS = [
  "schedule",
  "schools",
  "bank",
  "registrationDocuments",
  "reregistrationFee",
  "reregistrationDocuments",
  "acceptedInstructions",
  "rejectedInstructions",
  "agreement",
] as const;
export type SetupGapKind = (typeof SETUP_GAP_KINDS)[number];

export const SETUP_GAPS: Record<SetupGapKind, { section: CycleSection; neededToOpen: boolean }> = {
  schedule: { section: "schedule", neededToOpen: true },
  schools: { section: "schedule", neededToOpen: true },
  bank: { section: "bank", neededToOpen: true },
  registrationDocuments: { section: "documents", neededToOpen: true },
  reregistrationFee: { section: "fees", neededToOpen: false },
  reregistrationDocuments: { section: "documents", neededToOpen: false },
  acceptedInstructions: { section: "messages", neededToOpen: false },
  rejectedInstructions: { section: "messages", neededToOpen: false },
  agreement: { section: "agreement", neededToOpen: false },
};

/** `schoolKey` is null for a gap in the cycle itself, such as the bank account. */
export const SetupGap = z.object({
  kind: z.enum(SETUP_GAP_KINDS),
  schoolKey: SchoolKey.nullable(),
});
export type SetupGap = z.infer<typeof SetupGap>;

export const NotReady = z.object({ gaps: z.array(SetupGap) });

export const AgreementVersion = z.object({
  id: z.uuid(),
  version: z.int().positive(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
});
export type AgreementVersion = z.infer<typeof AgreementVersion>;

const Instructions = z.string().trim().max(2000).nullable();

/** One school's part of a cycle, defaults filled in. A school with no row takes part. */
export const SchoolSetup = z.object({
  schoolKey: SchoolKey,
  isEnabled: z.boolean(),
  feeOverride: Rupiah.nullable(),
  effectiveFee: Rupiah,
  reregistrationFee: Rupiah.nullable(),
  registrationDocuments: z.array(DocumentRequirement),
  reregistrationDocuments: z.array(DocumentRequirement),
  acceptedInstructions: Instructions,
  rejectedInstructions: Instructions,
  agreement: AgreementVersion.nullable(),
  agreementVersions: z.int().nonnegative(),
});
export type SchoolSetup = z.infer<typeof SchoolSetup>;

/** The fields a change in the history can name. */
export const CYCLE_FIELDS = [
  "name",
  "status",
  "registrationOpenAt",
  "registrationCloseAt",
  "resultPublishAt",
  "defaultFee",
  "bankName",
  "bankAccountNumber",
  "bankAccountHolder",
  "isEnabled",
  "fee",
  "reregistrationFee",
  "registrationDocuments",
  "reregistrationDocuments",
  "acceptedInstructions",
  "rejectedInstructions",
  "agreement",
] as const;
export const CycleField = z.enum(CYCLE_FIELDS);
export type CycleField = z.infer<typeof CycleField>;

/** `agreement` holds a version number; documents hold the list; the rest are scalars. */
export const ChangeValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(DocumentRequirement),
]);
export type ChangeValue = z.infer<typeof ChangeValue>;

/** One changed field, before and after. This is also the stored audit shape. */
export const FieldChange = z.object({
  field: CycleField,
  schoolKey: SchoolKey.nullable(),
  from: ChangeValue,
  to: ChangeValue,
});
export type FieldChange = z.infer<typeof FieldChange>;

export const CycleChange = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  who: z.string().nullable(),
  created: z.boolean(),
  changes: z.array(FieldChange),
});
export type CycleChange = z.infer<typeof CycleChange>;

/**
 * The cycle page in one read. `schools` holds only the caller's schools; `gaps`
 * covers every school, because opening registration opens it for all of them.
 */
export const CycleSetup = z.object({
  cycle: AdmissionCycle,
  schools: z.array(SchoolSetup),
  gaps: z.array(SetupGap),
  history: z.array(CycleChange),
});
export type CycleSetup = z.infer<typeof CycleSetup>;

const distinctSchools = (rows: readonly { schoolKey: SchoolKey }[]) =>
  new Set(rows.map((row) => row.schoolKey)).size === rows.length;

/** One row per school at most, so a save cannot write a school twice. */
const perSchool = <T extends z.ZodType<{ schoolKey: SchoolKey }>>(row: T) =>
  z.array(row).refine(distinctSchools, "Sekolah tidak boleh diulang.");

const uniqueTypes = z
  .array(DocumentRequirement)
  .refine(
    (documents) => new Set(documents.map((document) => document.type)).size === documents.length,
    "Jenis dokumen tidak boleh diulang.",
  );

/** One side panel's save. Each writes only its own fields, so two panels never undo each other. */
export const SaveCycleInput = z.discriminatedUnion("section", [
  Schedule.extend({
    section: z.literal("schedule"),
    cycleId: z.uuid(),
    name: CycleName,
    schools: perSchool(z.object({ schoolKey: SchoolKey, isEnabled: z.boolean() })),
  }).superRefine(orderedDates),
  z.object({ section: z.literal("bank"), cycleId: z.uuid(), bank: BankAccount }),
  z.object({
    section: z.literal("fees"),
    cycleId: z.uuid(),
    defaultFee: Rupiah,
    schools: perSchool(
      z.object({
        schoolKey: SchoolKey,
        feeOverride: Rupiah.nullable(),
        reregistrationFee: Rupiah.nullable(),
      }),
    ),
  }),
  z.object({
    section: z.literal("documents"),
    cycleId: z.uuid(),
    schools: perSchool(
      z.object({ schoolKey: SchoolKey, registration: uniqueTypes, reregistration: uniqueTypes }),
    ),
  }),
  z.object({
    section: z.literal("messages"),
    cycleId: z.uuid(),
    schools: perSchool(
      z.object({
        schoolKey: SchoolKey,
        acceptedInstructions: Instructions,
        rejectedInstructions: Instructions,
      }),
    ),
  }),
  z.object({
    section: z.literal("agreement"),
    cycleId: z.uuid(),
    schools: perSchool(
      z.object({ schoolKey: SchoolKey, body: z.string().trim().min(1).max(20_000) }),
    ),
  }),
]);
export type SaveCycleInput = z.infer<typeof SaveCycleInput>;

export const AgreementVersionsInput = z.object({ schoolKey: SchoolKey });
