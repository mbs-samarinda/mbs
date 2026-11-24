import type {
  ActorType,
  ApplicationCommand,
  ApplicationStage,
  CommandPayload,
  FamilyStage,
} from "@mbs/api-contract";
import { END_STAGES } from "@mbs/school-config";

type Transition = Effects &
  (
    | { from: "NONE"; to: ApplicationStage }
    | { from: readonly ApplicationStage[] | "ANY_OPEN"; to: ApplicationStage | "SAME" }
  );

type Effects = {
  actors: readonly ActorType[];
  familyVisible: boolean;
  notification: string | null;
  requiresNewest?: Requirement;
};

type Requirement = {
  [C in ApplicationCommand]: { command: C; payload: Partial<CommandPayload<C>> };
}[ApplicationCommand];

const FAMILY = ["FAMILY"] as const;
const STAFF = ["STAFF"] as const;
const SYSTEM = ["SYSTEM"] as const;

export const TRANSITIONS = {
  SUBMIT: {
    from: "NONE",
    to: "PAYMENT_DUE",
    actors: FAMILY,
    familyVisible: true,
    notification: "application-submitted",
  },
  UPLOAD_PAYMENT_PROOF: {
    from: ["PAYMENT_DUE"],
    to: "PAYMENT_REVIEW",
    actors: FAMILY,
    familyVisible: true,
    notification: "payment-received",
  },
  APPROVE_PAYMENT: {
    from: ["PAYMENT_REVIEW"],
    to: "DOCUMENTS_DUE",
    actors: STAFF,
    familyVisible: true,
    notification: "payment-approved",
  },
  REJECT_PAYMENT: {
    from: ["PAYMENT_REVIEW"],
    to: "PAYMENT_DUE",
    actors: STAFF,
    familyVisible: true,
    notification: "payment-rejected",
  },
  SUBMIT_DOCUMENTS: {
    from: ["DOCUMENTS_DUE"],
    to: "DOCUMENTS_REVIEW",
    actors: FAMILY,
    familyVisible: true,
    notification: "documents-received",
  },
  REQUEST_DOCUMENT_FIX: {
    from: ["DOCUMENTS_REVIEW"],
    to: "DOCUMENTS_DUE",
    actors: STAFF,
    familyVisible: true,
    notification: "documents-need-fix",
  },
  VERIFY_DOCUMENTS: {
    from: ["DOCUMENTS_REVIEW"],
    to: "SCREENING",
    actors: STAFF,
    familyVisible: true,
    notification: "documents-verified",
  },
  ADVANCE_TO_INTERVIEW: {
    from: ["SCREENING"],
    to: "INTERVIEW_PENDING",
    actors: STAFF,
    familyVisible: true,
    notification: "advanced-to-interview",
  },
  STOP_AT_SCREENING: {
    from: ["SCREENING"],
    to: "NOT_ADVANCED",
    actors: STAFF,
    familyVisible: true,
    notification: "stopped-at-screening",
  },
  SCHEDULE_INTERVIEW: {
    from: ["INTERVIEW_PENDING"],
    to: "INTERVIEW_SCHEDULED",
    actors: STAFF,
    familyVisible: true,
    notification: "interview-scheduled",
  },
  RESCHEDULE_INTERVIEW: {
    from: ["INTERVIEW_SCHEDULED"],
    to: "SAME",
    actors: STAFF,
    familyVisible: true,
    notification: "interview-rescheduled",
  },
  RECORD_ATTENDED: {
    from: ["INTERVIEW_SCHEDULED"],
    to: "INTERVIEWED",
    actors: STAFF,
    familyVisible: true,
    notification: "interview-attended",
  },
  RECORD_NO_SHOW: {
    from: ["INTERVIEW_SCHEDULED"],
    to: "INTERVIEW_PENDING",
    actors: STAFF,
    familyVisible: true,
    notification: "interview-missed",
  },
  DECIDE: {
    from: ["INTERVIEWED", "DECIDED"],
    to: "DECIDED",
    actors: STAFF,
    familyVisible: false,
    notification: null,
  },
  PUBLISH_ACCEPTED: {
    from: ["DECIDED"],
    to: "REREGISTRATION",
    actors: SYSTEM,
    familyVisible: true,
    notification: "result-accepted",
    requiresNewest: { command: "DECIDE", payload: { decision: "ACCEPTED" } },
  },
  PUBLISH_NOT_ACCEPTED: {
    from: ["DECIDED"],
    to: "NOT_ACCEPTED",
    actors: SYSTEM,
    familyVisible: true,
    notification: "result-not-accepted",
    requiresNewest: { command: "DECIDE", payload: { decision: "NOT_ACCEPTED" } },
  },
  SUBMIT_REREGISTRATION: {
    from: ["REREGISTRATION"],
    to: "REREGISTRATION_REVIEW",
    actors: FAMILY,
    familyVisible: true,
    notification: "reregistration-received",
  },
  REQUEST_REREGISTRATION_FIX: {
    from: ["REREGISTRATION_REVIEW"],
    to: "REREGISTRATION",
    actors: STAFF,
    familyVisible: true,
    notification: "reregistration-needs-fix",
  },
  CONFIRM_ENROLLMENT: {
    from: ["REREGISTRATION_REVIEW"],
    to: "ENROLLED",
    actors: STAFF,
    familyVisible: true,
    notification: "enrolled",
  },
  WITHDRAW: {
    from: "ANY_OPEN",
    to: "WITHDRAWN",
    actors: ["FAMILY", "STAFF"],
    familyVisible: true,
    notification: "withdrawn",
  },
  ADD_NOTE: {
    from: "ANY_OPEN",
    to: "SAME",
    actors: STAFF,
    familyVisible: false,
    notification: null,
  },
  CHANGE_INTERVIEW_MODE: {
    from: ["DOCUMENTS_DUE", "DOCUMENTS_REVIEW", "SCREENING", "INTERVIEW_PENDING"],
    to: "SAME",
    actors: ["FAMILY", "STAFF"],
    familyVisible: true,
    notification: null,
  },
  EDIT_PROFILE: {
    from: "ANY_OPEN",
    to: "SAME",
    actors: ["FAMILY", "STAFF"],
    familyVisible: true,
    notification: null,
  },
} as const satisfies Record<ApplicationCommand, Transition>;

export type NotificationKey = NonNullable<(typeof TRANSITIONS)[ApplicationCommand]["notification"]>;

export type TransitionResult =
  | { ok: true; to: ApplicationStage; familyVisible: boolean; notification: NotificationKey | null }
  | { ok: false; refusal: "ILLEGAL_STAGE" | "ACTOR_NOT_ALLOWED" | "REQUIREMENT_UNMET" };

/** A decided application reads as still waiting, so a family learns nothing before publication. */
export function familyStage(stage: ApplicationStage): FamilyStage {
  return stage === "DECIDED" ? "INTERVIEWED" : stage;
}

export function isEndStage(stage: ApplicationStage) {
  return (END_STAGES as readonly ApplicationStage[]).includes(stage);
}

export function requiredCommand(command: ApplicationCommand) {
  const row: Transition = TRANSITIONS[command];
  return row.requiresNewest?.command ?? null;
}

export function transition(
  stage: ApplicationStage | null,
  command: ApplicationCommand,
  actorType: ActorType,
  newestRequiredPayload?: unknown,
): TransitionResult {
  const row: Transition = TRANSITIONS[command];

  const to = destination(row, stage);
  if (to === null) return { ok: false, refusal: "ILLEGAL_STAGE" };
  if (!row.actors.includes(actorType)) return { ok: false, refusal: "ACTOR_NOT_ALLOWED" };
  if (row.requiresNewest && !carries(newestRequiredPayload, row.requiresNewest.payload)) {
    return { ok: false, refusal: "REQUIREMENT_UNMET" };
  }

  return {
    ok: true,
    to,
    familyVisible: row.familyVisible,
    notification: TRANSITIONS[command].notification,
  };
}

function destination(row: Transition, stage: ApplicationStage | null) {
  if (row.from === "NONE") return stage === null ? row.to : null;
  if (stage === null) return null;
  const allowed = row.from === "ANY_OPEN" ? !isEndStage(stage) : row.from.includes(stage);
  if (!allowed) return null;
  return row.to === "SAME" ? stage : row.to;
}

function carries(payload: unknown, fields: object) {
  if (typeof payload !== "object" || payload === null) return false;
  const actual = new Map(Object.entries(payload));
  return Object.entries(fields).every(([key, value]) => actual.get(key) === value);
}
