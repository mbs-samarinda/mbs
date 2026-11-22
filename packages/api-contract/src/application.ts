import {
  ACTOR_TYPES,
  APPLICATION_COMMANDS,
  APPLICATION_STAGES,
  INTERVIEW_MODES,
} from "@mbs/school-config";
import { z } from "zod";

import { SchoolKey } from "./schemas.ts";

export const ApplicationStage = z.enum(APPLICATION_STAGES);
export type ApplicationStage = z.infer<typeof ApplicationStage>;

export const ApplicationCommand = z.enum(APPLICATION_COMMANDS);
export type ApplicationCommand = z.infer<typeof ApplicationCommand>;

export const ActorType = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

export const InterviewMode = z.enum(INTERVIEW_MODES);
export type InterviewMode = z.infer<typeof InterviewMode>;

/** Families type NIKs with spaces or dots. Stored as the 16 digits alone. */
export const Nik = z
  .string()
  .transform((value) => value.replaceAll(/[\s.]/g, ""))
  .pipe(z.string().regex(/^\d{16}$/, "A NIK is 16 digits."));

export const ApplicantProfile = z.object({
  childFullName: z.string().trim().min(1).max(200),
  nik: Nik,
  birthDate: z.iso.date(),
  sex: z.enum(["MALE", "FEMALE"]),
  schoolOfOrigin: z.string().trim().min(1).max(200),
  guardianName: z.string().trim().min(1).max(200),
  guardianRelation: z.string().trim().min(1).max(100),
  guardianPhone: z.string().trim().min(6).max(30),
});
export type ApplicantProfile = z.infer<typeof ApplicantProfile>;
/** The form as typed, before the NIK is normalized. */
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

/**
 * One application as its family sees it. P4 grows this into the status page;
 * today it is what proves a family reaches only its own applications.
 */
export const ApplicantApplication = z.object({
  id: z.uuid(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  stage: ApplicationStage,
});
export type ApplicantApplication = z.infer<typeof ApplicantApplication>;
