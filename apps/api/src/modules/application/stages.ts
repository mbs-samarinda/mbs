import type { ActorType, ApplicationCommand, ApplicationStage } from "@mbs/api-contract";

/** Nothing moves an application out of these. */
export const END_STAGES = [
  "ENROLLED",
  "NOT_ADVANCED",
  "NOT_ACCEPTED",
  "WITHDRAWN",
] as const satisfies readonly ApplicationStage[];

type Transition = {
  /** `NONE` is the one command that creates an application. */
  from: readonly ApplicationStage[] | "NONE" | "ANY_OPEN";
  /** `SAME` records an event without moving the application. */
  to: ApplicationStage | "SAME";
  actors: readonly ActorType[];
  familyVisible: boolean;
  /** The email template P2's outbox sends, or null for none. */
  notification: string | null;
};

const FAMILY = ["FAMILY"] as const;
const STAFF = ["STAFF"] as const;
const SYSTEM = ["SYSTEM"] as const;

/**
 * Every write to an application's stage goes through this table (see
 * knowledge/docs/admission.md, "Stages are one table"). A new step is a new
 * row here, never an `if` somewhere else. Keyed by command, so a command added
 * to APPLICATION_COMMANDS without a row fails to compile.
 */
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
    notification: null,
  },
  RECORD_NO_SHOW: {
    from: ["INTERVIEW_SCHEDULED"],
    to: "INTERVIEW_PENDING",
    actors: STAFF,
    familyVisible: true,
    notification: "interview-missed",
  },
  // A decision can be changed until it is published. The family sees nothing
  // until PUBLISH_*, so it is hidden and sends nothing. Refusing a change after
  // resultPublishAt needs a clock, which is the publish step's job, not this
  // table's.
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
  },
  PUBLISH_NOT_ACCEPTED: {
    from: ["DECIDED"],
    to: "NOT_ACCEPTED",
    actors: SYSTEM,
    familyVisible: true,
    notification: "result-not-accepted",
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
  // Internal: families never see staff notes.
  ADD_NOTE: {
    from: "ANY_OPEN",
    to: "SAME",
    actors: STAFF,
    familyVisible: false,
    notification: null,
  },
  // Until the interview is booked, the family may switch between offline and
  // online, and staff may switch it for them.
  CHANGE_INTERVIEW_MODE: {
    from: ["DOCUMENTS_DUE", "DOCUMENTS_REVIEW", "SCREENING", "INTERVIEW_PENDING"],
    to: "SAME",
    actors: ["FAMILY", "STAFF"],
    familyVisible: true,
    notification: null,
  },
} as const satisfies Record<ApplicationCommand, Transition>;

export type TransitionResult =
  | { ok: true; to: ApplicationStage; familyVisible: boolean; notification: string | null }
  | { ok: false; refusal: "ILLEGAL_STAGE" | "ACTOR_NOT_ALLOWED" };

export function isEndStage(stage: ApplicationStage) {
  return (END_STAGES as readonly ApplicationStage[]).includes(stage);
}

/**
 * Whether `actorType` may run `command` on an application in `stage` (null
 * before it exists), and where it lands. Pure: it reads only the table.
 */
export function transition(
  stage: ApplicationStage | null,
  command: ApplicationCommand,
  actorType: ActorType,
): TransitionResult {
  const row: Transition = TRANSITIONS[command];

  if (!fromAllows(row.from, stage)) return { ok: false, refusal: "ILLEGAL_STAGE" };
  if (!row.actors.includes(actorType)) return { ok: false, refusal: "ACTOR_NOT_ALLOWED" };

  // `fromAllows` only lets a null stage through for NONE rows, whose `to` is a
  // real stage, so SAME always has a stage to stay in.
  const to = row.to === "SAME" ? stage! : row.to;
  return { ok: true, to, familyVisible: row.familyVisible, notification: row.notification };
}

function fromAllows(from: Transition["from"], stage: ApplicationStage | null) {
  if (stage === null) return from === "NONE";
  if (from === "NONE") return false;
  if (from === "ANY_OPEN") return !isEndStage(stage);
  return from.includes(stage);
}
