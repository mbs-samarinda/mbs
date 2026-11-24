import {
  ACTOR_TYPES,
  APPLICATION_COMMANDS,
  APPLICATION_STAGES,
  INTERVIEW_MODES,
  MILESTONES,
} from "@mbs/school-config";
import { z } from "zod";

import { APPLICANT_RULES, type Rule } from "./applicant-rules.ts";
import { DocumentRequirement, SchoolKey } from "./schemas.ts";

export const ApplicationStage = z.enum(APPLICATION_STAGES);
export type ApplicationStage = z.infer<typeof ApplicationStage>;

export const ApplicationCommand = z.enum(APPLICATION_COMMANDS);
export type ApplicationCommand = z.infer<typeof ApplicationCommand>;

export const ActorType = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

export const InterviewMode = z.enum(INTERVIEW_MODES);
export type InterviewMode = z.infer<typeof InterviewMode>;

function ruled<T extends string>(rule: Rule<T>) {
  return z.string().transform((raw, ctx) => {
    const result = rule(raw, new Date());
    if (result.ok) return result.value;
    ctx.addIssue({ code: "custom", message: result.message });
    return z.NEVER;
  });
}

/**
 * Parses what a family typed, never a stored row: the age rule is true on the
 * day of input and stops being true as the child grows.
 */
export const ApplicantProfile = z.object({
  childFullName: ruled(APPLICANT_RULES.childFullName),
  nik: ruled(APPLICANT_RULES.nik),
  birthDate: ruled(APPLICANT_RULES.birthDate),
  sex: ruled(APPLICANT_RULES.sex),
  schoolOfOrigin: ruled(APPLICANT_RULES.schoolOfOrigin),
  guardianName: ruled(APPLICANT_RULES.guardianName),
  guardianRelation: ruled(APPLICANT_RULES.guardianRelation),
  guardianPhone: ruled(APPLICANT_RULES.guardianPhone),
});
export type ApplicantProfile = z.infer<typeof ApplicantProfile>;
/** The form as typed. */
export type ApplicantProfileInput = z.input<typeof ApplicantProfile>;

const Reason = z.string().trim().min(1).max(2000);
const v1 = { payloadVersion: z.literal(1) };

export const COMMAND_PAYLOADS = {
  SUBMIT: z.object(v1),
  UPLOAD_PAYMENT_PROOF: z.object(v1),
  APPROVE_PAYMENT: z.object(v1),
  REJECT_PAYMENT: z.object({ ...v1, reason: Reason }),
  SUBMIT_DOCUMENTS: z.object(v1),
  REQUEST_DOCUMENT_FIX: z.object({ ...v1, reason: Reason }),
  VERIFY_DOCUMENTS: z.object(v1),
  ADVANCE_TO_INTERVIEW: z.object(v1),
  STOP_AT_SCREENING: z.object({ ...v1, reason: Reason }),
  SCHEDULE_INTERVIEW: z.object(v1),
  RESCHEDULE_INTERVIEW: z.object({ ...v1, reason: Reason.optional() }),
  RECORD_ATTENDED: z.object(v1),
  RECORD_NO_SHOW: z.object(v1),
  DECIDE: z.object({ ...v1, decision: z.enum(["ACCEPTED", "NOT_ACCEPTED"]) }),
  PUBLISH_ACCEPTED: z.object(v1),
  PUBLISH_NOT_ACCEPTED: z.object(v1),
  SUBMIT_REREGISTRATION: z.object(v1),
  REQUEST_REREGISTRATION_FIX: z.object({ ...v1, reason: Reason }),
  CONFIRM_ENROLLMENT: z.object(v1),
  WITHDRAW: z.object({ ...v1, reason: Reason.optional() }),
  ADD_NOTE: z.object({ ...v1, note: Reason }),
  CHANGE_INTERVIEW_MODE: z.object({ ...v1, mode: InterviewMode }),
  EDIT_PROFILE: z.object({ ...v1, version: z.number().int().min(1) }),
} satisfies Record<ApplicationCommand, z.ZodType<{ payloadVersion: 1 }>>;

export type CommandPayload<C extends ApplicationCommand> = z.infer<(typeof COMMAND_PAYLOADS)[C]>;

/** EDIT_PROFILE is left out: `saveProfile` writes its payload from the profile itself. */
export const AppliedCommand = ApplicationCommand.exclude(["EDIT_PROFILE"]);
export type AppliedCommand = z.infer<typeof AppliedCommand>;

/** What a family may know. A decision stays hidden until it is published. */
export const FamilyStage = ApplicationStage.exclude(["DECIDED"]);
export type FamilyStage = z.infer<typeof FamilyStage>;

export const FamilyCommand = ApplicationCommand.exclude(["DECIDE", "ADD_NOTE"]);
export type FamilyCommand = z.infer<typeof FamilyCommand>;

/**
 * No id, sequence number or stage: each would give away a hidden event, the
 * sequence by its gaps and a publish event by the stage it left.
 */
export const FamilyEvent = z.object({
  command: FamilyCommand,
  at: z.iso.datetime(),
  actor: ActorType,
  /** The committee's reason, when the family is meant to read it. */
  reason: z.string().nullable(),
});
export type FamilyEvent = z.infer<typeof FamilyEvent>;

export const FamilyApplicationSummary = z.object({
  id: z.uuid(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  childName: z.string(),
  stage: FamilyStage,
});
export type FamilyApplicationSummary = z.infer<typeof FamilyApplicationSummary>;

export const FamilyApplication = FamilyApplicationSummary.extend({
  registrationFee: z.int().nonnegative(),
  /** The registration documents promised when the family submitted. */
  documents: z.array(DocumentRequirement),
  resultPublishAt: z.iso.datetime(),
  /** Oldest first. */
  events: z.array(FamilyEvent),
});
export type FamilyApplication = z.infer<typeof FamilyApplication>;

export const SubmitApplicationInput = z.object({
  cycleId: z.uuid(),
  schoolKey: SchoolKey,
  profile: ApplicantProfile,
  /** Made once on the device. The same key again returns the first result. */
  idempotencyKey: z.uuid(),
});
export type SubmitApplicationInput = z.infer<typeof SubmitApplicationInput>;

export const SubmittedApplication = z.object({ applicationId: z.uuid() });
export type SubmittedApplication = z.infer<typeof SubmittedApplication>;

/**
 * What the key was first used for. Keys belong to one account, so this is always
 * the caller's own application. `sameRegistration` is whether the refused form
 * was for that child at that school, or for another one.
 */
export const ReusedKey = SubmittedApplication.extend({ sameRegistration: z.boolean() });
export type ReusedKey = z.infer<typeof ReusedKey>;

/**
 * As typed. Any text is accepted here, because a number or NIK that could never
 * exist has to be counted and answered exactly like one that does not.
 */
export const CheckStatusInput = z.object({ registrationNumber: z.string(), nik: z.string() });
export type CheckStatusInput = z.infer<typeof CheckStatusInput>;

/**
 * All that someone without an account may see. Written out, not made from
 * `FamilyApplication`, so a field added there never shows here by itself.
 */
export const CheckedStatus = z.object({
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  childName: z.string(),
  stage: FamilyStage,
  /** The milestones that are finished, and when. */
  finished: z.partialRecord(z.enum(MILESTONES), z.iso.datetime()),
});
export type CheckedStatus = z.infer<typeof CheckedStatus>;

export const TooManyTries = z.object({ retryAfterSeconds: z.int().positive() });
export type TooManyTries = z.infer<typeof TooManyTries>;
