import { GUARDIAN_RELATIONS, SEXES } from "@mbs/school-config";
import { z } from "zod";

import {
  ActorType,
  ApplicationCommand,
  ApplicationStage,
  COMMAND_PAYLOADS,
} from "./application.ts";
import { SchoolKey } from "./schemas.ts";

// What the committee reads. Every answer is limited to the caller's schools and
// the current cycle.

const At = z.iso.datetime();

/** `SYSTEM` carries no name: the interface words it, so the server never writes copy. */
export const Actor = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STAFF"), name: z.string() }),
  z.object({ type: z.literal("FAMILY"), name: z.string() }),
  z.object({ type: z.literal("SYSTEM") }),
]);
export type Actor = z.infer<typeof Actor>;

/** Audit rows also come from a status check without an account, which has no one to name. */
export const AuditActor = z.discriminatedUnion("type", [
  ...Actor.options,
  z.object({ type: z.literal("PUBLIC") }),
]);
export type AuditActor = z.infer<typeof AuditActor>;

/** The audit actions an application's history shows. A row with any other action is left out. */
export const AUDIT_ACTIONS = ["application.viewed", "application.status_checked"] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

export const Decision = COMMAND_PAYLOADS.DECIDE.shape.decision;
export type Decision = z.infer<typeof Decision>;

const EventFields = {
  command: ApplicationCommand,
  actor: Actor,
  at: At,
  /** A note or the committee's reason, as written. */
  text: z.string().nullable(),
  /** Only on DECIDE. */
  decision: Decision.nullable(),
};

/** One recent event across the caller's schools, for Beranda. */
export const ActivityItem = z.object({
  ...EventFields,
  applicationId: z.uuid(),
  schoolKey: SchoolKey,
  childName: z.string(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const CommitteeDashboard = z.object({
  cycle: z.object({ name: z.string(), closesAt: At }).nullable(),
  total: z.int().nonnegative(),
  newThisWeek: z.int().nonnegative(),
  paid: z.int().nonnegative(),
  needsCommittee: z.int().nonnegative(),
  /** When the longest-waiting application reached its stage. Null when nothing waits. */
  oldestWaitingSince: At.nullable(),
  accepted: z.int().nonnegative(),
  decided: z.int().nonnegative(),
  /** One entry per school of the caller, zeros included. */
  perSchool: z.array(z.object({ schoolKey: SchoolKey, total: z.int().nonnegative() })),
  /** Newest first, at most five. */
  recent: z.array(ActivityItem),
});
export type CommitteeDashboard = z.infer<typeof CommitteeDashboard>;

export const COMMITTEE_PAGE_SIZE = 50;

export const CommitteeView = z.enum(["ALL", "NEEDS_COMMITTEE"]);
export type CommitteeView = z.infer<typeof CommitteeView>;

/** Search never matches a NIK: the query sits in the address bar and the browser history. */
export const ListApplicationsInput = z.object({
  school: SchoolKey.optional(),
  view: CommitteeView,
  q: z.string().trim().max(100).optional(),
  page: z.int().min(1),
});
export type ListApplicationsInput = z.infer<typeof ListApplicationsInput>;

export const CommitteeApplicationRow = z.object({
  id: z.uuid(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  childName: z.string(),
  guardianName: z.string(),
  guardianPhone: z.string(),
  stage: ApplicationStage,
  /** The committee acts next. */
  needsCommittee: z.boolean(),
  stageChangedAt: At,
  lastActivity: z.object({ command: ApplicationCommand, actorType: ActorType, at: At }),
});
export type CommitteeApplicationRow = z.infer<typeof CommitteeApplicationRow>;

export const CommitteeApplicationPage = z.object({
  rows: z.array(CommitteeApplicationRow),
  total: z.int().nonnegative(),
  page: z.int().min(1),
  pageSize: z.literal(COMMITTEE_PAGE_SIZE),
});
export type CommitteeApplicationPage = z.infer<typeof CommitteeApplicationPage>;

/**
 * The newest saved form. Stored rows are read as they are, not re-run through the
 * form's rules: the age rule was true on the day of input, not today.
 */
export const StoredApplicantProfile = z.object({
  childFullName: z.string(),
  nik: z.string(),
  birthDate: z.iso.date(),
  sex: z.enum(SEXES),
  schoolOfOrigin: z.string(),
  guardianName: z.string(),
  guardianRelation: z.enum(GUARDIAN_RELATIONS),
  guardianPhone: z.string(),
});
export type StoredApplicantProfile = z.infer<typeof StoredApplicantProfile>;

export const HistoryItem = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EVENT"),
    seq: z.int().min(1),
    fromStage: ApplicationStage.nullable(),
    toStage: ApplicationStage,
    familyVisible: z.boolean(),
    ...EventFields,
  }),
  z.object({ kind: z.literal("AUDIT"), action: AuditAction, actor: AuditActor, at: At }),
]);
export type HistoryItem = z.infer<typeof HistoryItem>;

export const CommitteeApplication = z.object({
  id: z.uuid(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  stage: ApplicationStage,
  needsCommittee: z.boolean(),
  stageChangedAt: At,
  lastEventSeq: z.int().min(1),
  profile: StoredApplicantProfile,
  /** The account that registered the child. */
  accountEmail: z.string(),
  /** False for a principal, who only reads, and once the application has ended. */
  canAddNote: z.boolean(),
  /** Newest first. */
  history: z.array(HistoryItem),
});
export type CommitteeApplication = z.infer<typeof CommitteeApplication>;

export const ApplicationRef = z.object({ applicationId: z.uuid() });
export type ApplicationRef = z.infer<typeof ApplicationRef>;

export const AddNoteInput = ApplicationRef.extend({
  note: COMMAND_PAYLOADS.ADD_NOTE.shape.note,
  /** Made once per note on the device, and kept while the same text is retried. */
  idempotencyKey: z.uuid(),
});
export type AddNoteInput = z.infer<typeof AddNoteInput>;

export const AddedNote = z.object({ seq: z.int().min(1) });
export type AddedNote = z.infer<typeof AddedNote>;
