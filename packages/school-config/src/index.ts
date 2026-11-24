/**
 * The fixed school list and the compile-time facts about each one. MBSS is one
 * organisation with a known set of schools, not a product schools sign up for,
 * so this is a constant — not a database table. Anything an administrator can
 * change (fees, dates, whether a school takes part in a cycle) lives in
 * PostgreSQL instead.
 *
 * Colors are not here either, for a different reason: they are CSS. An owner's
 * full palette is one custom property block per owner in `apps/profile`, and the
 * committee app's school marks use the `--school-<key>` tokens in `packages/ui`.
 * A copy here would be a third place to keep in step.
 *
 * `shortName` is the brand guide's approved shorter name, for navigation and
 * compact repeated context.
 * Nor is the owner list — the umbrella is an owner and not a school, so
 * `OWNERS` lives beside those blocks.
 *
 * The closed value lists of the admission domain (cycle status, document type,
 * staff role, application stage and command, and the rest) live here too, at
 * the bottom.
 */
export const SCHOOLS = [
  {
    key: "smp",
    name: "SMP Islam Terpadu Madina",
    shortName: "SMP IT Madina",
    level: "SMP",
    subdomain: "smp",
  },
  {
    key: "smk",
    name: "SMK Terpadu Madina",
    shortName: "SMK Terpadu Madina",
    level: "SMK",
    subdomain: "smk",
  },
  {
    key: "sma",
    name: "SMA Madina Citra Insani",
    shortName: "SMA MCI",
    level: "SMA",
    subdomain: "sma",
  },
] as const;

export type School = (typeof SCHOOLS)[number];
export type SchoolKey = School["key"];

export const SCHOOL_KEYS = SCHOOLS.map((school) => school.key);

/**
 * Drizzle's pgEnum and the contract's z.enum both read these. They live here
 * because this package imports nothing, so browser code can import it too.
 * Adding a value needs a migration: run `pnpm db:generate`. Postgres cannot
 * drop or rename an enum value, so removing or renaming one needs a
 * hand-written migration for the rows that hold it.
 */
export const CYCLE_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;
export const DOCUMENT_TYPES = [
  "KARTU_KELUARGA",
  "AKTA_KELAHIRAN",
  "KARTU_IDENTITAS_ANAK",
  "IJAZAH",
] as const;
export const STAFF_ROLES = ["ADMINISTRATOR", "STAFF", "PRINCIPAL"] as const;
export const STAFF_LOGIN_EMAIL_KINDS = ["INSTITUTIONAL", "PERSONAL"] as const;

export const DOCUMENT_STAGES = ["REGISTRATION", "REREGISTRATION"] as const;
export const INTERVIEW_MODES = ["OFFLINE", "ONLINE"] as const;

export const APPLICATION_STAGES = [
  "PAYMENT_DUE",
  "PAYMENT_REVIEW",
  "DOCUMENTS_DUE",
  "DOCUMENTS_REVIEW",
  "SCREENING",
  "INTERVIEW_PENDING",
  "INTERVIEW_SCHEDULED",
  "INTERVIEWED",
  "DECIDED",
  "REREGISTRATION",
  "REREGISTRATION_REVIEW",
  "ENROLLED",
  "NOT_ADVANCED",
  "NOT_ACCEPTED",
  "WITHDRAWN",
] as const;

export const END_STAGES = [
  "ENROLLED",
  "NOT_ADVANCED",
  "NOT_ACCEPTED",
  "WITHDRAWN",
] as const satisfies readonly (typeof APPLICATION_STAGES)[number][];

export const APPLICATION_COMMANDS = [
  "SUBMIT",
  "UPLOAD_PAYMENT_PROOF",
  "APPROVE_PAYMENT",
  "REJECT_PAYMENT",
  "SUBMIT_DOCUMENTS",
  "REQUEST_DOCUMENT_FIX",
  "VERIFY_DOCUMENTS",
  "ADVANCE_TO_INTERVIEW",
  "STOP_AT_SCREENING",
  "SCHEDULE_INTERVIEW",
  "RESCHEDULE_INTERVIEW",
  "RECORD_ATTENDED",
  "RECORD_NO_SHOW",
  "DECIDE",
  "PUBLISH_ACCEPTED",
  "PUBLISH_NOT_ACCEPTED",
  "SUBMIT_REREGISTRATION",
  "REQUEST_REREGISTRATION_FIX",
  "CONFIRM_ENROLLMENT",
  "WITHDRAW",
  "ADD_NOTE",
  "CHANGE_INTERVIEW_MODE",
  "EDIT_PROFILE",
] as const;

/** The road a family follows, in order. */
export const MILESTONES = [
  "REGISTRATION",
  "PAYMENT",
  "DOCUMENTS",
  "SCREENING",
  "INTERVIEW",
  "ANNOUNCEMENT",
  "REREGISTRATION",
] as const;
export type Milestone = (typeof MILESTONES)[number];
export type FinishedMilestones = { [M in Milestone]?: string };

const FINISHES: { [C in (typeof APPLICATION_COMMANDS)[number]]?: Milestone } = {
  SUBMIT: "REGISTRATION",
  APPROVE_PAYMENT: "PAYMENT",
  VERIFY_DOCUMENTS: "DOCUMENTS",
  ADVANCE_TO_INTERVIEW: "SCREENING",
  STOP_AT_SCREENING: "SCREENING",
  RECORD_ATTENDED: "INTERVIEW",
  PUBLISH_ACCEPTED: "ANNOUNCEMENT",
  PUBLISH_NOT_ACCEPTED: "ANNOUNCEMENT",
  CONFIRM_ENROLLMENT: "REREGISTRATION",
};

/**
 * When each milestone was finished, from the events a family may see, oldest
 * first. Both sides run it: the status page on the events it has, and the API
 * for a lookup, whose answer carries no events.
 */
export function finishedMilestones(
  events: readonly { command: (typeof APPLICATION_COMMANDS)[number]; at: string }[],
): FinishedMilestones {
  const finished: FinishedMilestones = {};
  for (const { command, at } of events) {
    const milestone = FINISHES[command];
    if (milestone) finished[milestone] = at;
  }
  return finished;
}

/** Far above a family, so a made-up account cannot fill a school's list. */
export const CHILDREN_PER_ACCOUNT = 10;

/** Kept in the form's JSON, not in a Postgres enum, so adding one needs no migration. */
export const SEXES = ["MALE", "FEMALE"] as const;
export const GUARDIAN_RELATIONS = ["FATHER", "MOTHER", "GUARDIAN"] as const;

export const ACTOR_TYPES = ["FAMILY", "STAFF", "SYSTEM"] as const;

export const NOTIFICATION_CHANNELS = ["EMAIL"] as const;
export const NOTIFICATION_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED"] as const;
export const NOTIFICATION_ATTEMPT_OUTCOMES = ["SENT", "FAILED", "DELIVERY_UNKNOWN"] as const;
export const SIGN_IN_CODE_TEMPLATE = "sign-in-code";

/**
 * Narrows a string read from the database to a school key. The schools table
 * holds the same fixed list, but its column is text, so this is where that
 * promise is checked rather than assumed.
 */
export function isSchoolKey(value: string): value is SchoolKey {
  return SCHOOLS.some((school) => school.key === value);
}
