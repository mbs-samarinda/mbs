import {
  ACTOR_TYPES,
  APPLICATION_COMMANDS,
  APPLICATION_STAGES,
  CYCLE_STATUSES,
  DOCUMENT_STAGES,
  DOCUMENT_TYPES,
  INTERVIEW_MODES,
  STAFF_LOGIN_EMAIL_KINDS,
  STAFF_ROLES,
} from "@mbs/school-config";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema.ts";

// Better Auth's tables are part of the same Drizzle schema object, so the
// adapter and every query see one schema. They live in their own file because
// their shape is dictated by better-auth, not by us.
export * from "./auth-schema.ts";

export const cycleStatus = pgEnum("cycle_status", CYCLE_STATUSES);

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Name and level are compile-time facts in @mbs/school-config, not columns.
  // Taking part in a cycle is school_admission_settings.is_enabled, not a
  // property of the school — and a school with no settings row is taking part.
  key: text("key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The cycle is global across MBSS. It deliberately carries no school_id, and
// every school takes part in every cycle by construction — so the cycle a
// school is showing can never differ from the cycle its neighbour shows.
export const admissionCycles = pgTable(
  "admission_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    registrationOpenAt: timestamp("registration_open_at", { withTimezone: true }).notNull(),
    registrationCloseAt: timestamp("registration_close_at", { withTimezone: true }).notNull(),
    resultPublishAt: timestamp("result_publish_at", { withTimezone: true }).notNull(),
    defaultFee: integer("default_fee").notNull(),
    status: cycleStatus("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Two open cycles would show families two sets of dates.
  (table) => [
    uniqueIndex("admission_cycles_one_open")
      .on(table.status)
      .where(sql`status = 'OPEN'`),
  ],
);

/**
 * One school's overrides for one cycle — never proof that it joined, because
 * membership is not a stored fact. No row means the school takes part at the
 * cycle's own defaults: enabled, at `defaultFee`. Deliberate non-participation
 * is `isEnabled = false`, never a missing row.
 */
export const schoolAdmissionSettings = pgTable(
  "school_admission_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    admissionCycleId: uuid("admission_cycle_id")
      .notNull()
      .references(() => admissionCycles.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    // Effective fee is feeOverride ?? cycle.defaultFee.
    feeOverride: integer("fee_override"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    // The standard next step a school tells an accepted or rejected family.
    // Written once per cycle rather than retyped into every decision.
    acceptedInstructions: text("accepted_instructions"),
    rejectedInstructions: text("rejected_instructions"),
  },
  (table) => [unique().on(table.admissionCycleId, table.schoolId)],
);

// A closed list, not free text: an application's documents have to line up with
// what was required, and a typo in a configured type would silently create a
// requirement nothing can ever satisfy. A new document costs one migration.
export const documentType = pgEnum("document_type", DOCUMENT_TYPES);
export const documentStage = pgEnum("document_stage", DOCUMENT_STAGES);

/**
 * What one school asks for in one cycle. Three states, two columns: no row
 * means the school does not collect that document at all, `required` false
 * means optional, true means it blocks submission.
 *
 * Applications snapshot this at creation, so editing it here never changes what
 * an existing application must provide.
 */
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    admissionCycleId: uuid("admission_cycle_id")
      .notNull()
      .references(() => admissionCycles.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    type: documentType("document_type").notNull(),
    required: boolean("required").notNull(),
    stage: documentStage("stage").notNull().default("APPLICATION"),
  },
  // Named explicitly: the generated name is longer than the 63 characters
  // Postgres keeps, so the snapshot would not match the database.
  (table) => [
    unique("document_requirements_cycle_school_stage_type_unique").on(
      table.admissionCycleId,
      table.schoolId,
      table.stage,
      table.type,
    ),
  ],
);

export const staffRole = pgEnum("staff_role", STAFF_ROLES);
export const staffLoginEmailKind = pgEnum("staff_login_email_kind", STAFF_LOGIN_EMAIL_KINDS);

/**
 * A member of the admission committee. Authorization is pre-approved here
 * before anyone signs in: a Better Auth identity gets in only by resolving to
 * one of these rows through staff_login_emails.
 *
 * There is no SUPER_ADMIN. An organisation-wide administrator is an
 * ADMINISTRATOR holding staff_school_access for every school; role and scope
 * are always two separate checks.
 */
export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: staffRole("role").notNull(),
  // Deactivated, never deleted: audit_logs and decisions reference this id.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The addresses that may sign in as one staff profile. `authUserId` is null
 * until the first successful sign-in binds the Better Auth identity, which is
 * what turns a pre-approval into a working login.
 */
export const staffLoginEmails = pgTable(
  "staff_login_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id),
    email: text("email").notNull().unique(),
    kind: staffLoginEmailKind("kind").notNull(),
    // Unique so one Better Auth identity can never resolve to two staff profiles.
    authUserId: text("auth_user_id")
      .unique()
      .references(() => user.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Lookups compare bytes, and Better Auth hands over a lowercased address. A
  // mixed-case row here would be an approval nobody can ever sign in with.
  () => [check("staff_login_emails_email_lowercase", sql`email = lower(email)`)],
);

/** The schools one staff profile may act in. A role never implies a school. */
export const staffSchoolAccess = pgTable(
  "staff_school_access",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
  },
  (table) => [primaryKey({ columns: [table.staffId, table.schoolId] })],
);

/**
 * Append-only business history. This is not the server log: it answers who
 * changed what, and when.
 *
 * Every append-only table carries the `forbid_history_change()` trigger, so
 * the database refuses an update, delete or truncate. The one way past it is
 * the bypass function in migration 0008, run by hand, which writes its own row
 * here. The list of these tables is in
 * `apps/api/src/history-tables.integration.test.ts`.
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  // Sanitized. Never NIK, document contents, cookies or tokens.
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  requestId: text("request_id"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationStage = pgEnum("application_stage", APPLICATION_STAGES);
export const applicationCommand = pgEnum("application_command", APPLICATION_COMMANDS);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const interviewMode = pgEnum("interview_mode", INTERVIEW_MODES);

/**
 * One child at one school in one cycle. This row is the current state, kept so
 * lists and locks have one row to read. The history behind it is in
 * `application_events` and `applicant_profile_versions`, which only grow.
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    admissionCycleId: uuid("admission_cycle_id")
      .notNull()
      .references(() => admissionCycles.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    // Counts from 1 per cycle and school. People read the number; it unlocks
    // nothing.
    registrationSeq: integer("registration_seq").notNull(),
    registrationNumber: text("registration_number").notNull(),
    stage: applicationStage("stage").notNull(),
    interviewMode: interviewMode("interview_mode"),
    // A copy of the latest profile's NIK, so the database itself refuses a
    // second application to the same school.
    nik: text("nik").notNull(),
    // What the school charged when the family applied. A later fee change in
    // the cycle settings never changes what this application owes.
    registrationFee: integer("registration_fee").notNull(),
    // A command names the seq it expects, so one made against an older view
    // gets a conflict instead of overwriting.
    lastEventSeq: integer("last_event_seq").notNull(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("applications_cycle_school_seq_unique").on(
      table.admissionCycleId,
      table.schoolId,
      table.registrationSeq,
    ),
    unique("applications_cycle_number_unique").on(table.admissionCycleId, table.registrationNumber),
    // One child may apply to several MBSS schools, but only once to each.
    unique("applications_cycle_school_nik_unique").on(
      table.admissionCycleId,
      table.schoolId,
      table.nik,
    ),
    check("applications_nik_digits", sql`nik ~ '^[0-9]{16}$'`),
  ],
);

/**
 * The documents this application was asked for, copied from
 * `document_requirements` when it was created. Append-only.
 */
export const applicationDocumentRequirements = pgTable(
  "application_document_requirements",
  {
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    stage: documentStage("stage").notNull(),
    type: documentType("document_type").notNull(),
    required: boolean("required").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.stage, table.type] })],
);

/** Which signed-in account may act on which application. One account, many children. */
export const applicationAccess = pgTable(
  "application_access",
  {
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.userId] })],
);

/** Every save of the family's form, as a new row. Append-only. */
export const applicantProfileVersions = pgTable(
  "applicant_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    version: integer("version").notNull(),
    // An ApplicantProfile from @mbs/api-contract. Personal data: this is the record.
    data: jsonb("data").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.applicationId, table.version)],
);

/**
 * The timeline, one row per command in seq order. The family's status page,
 * the committee's history and the email queue all read it, so they cannot
 * disagree. Append-only.
 */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    seq: integer("seq").notNull(),
    command: applicationCommand("command").notNull(),
    // Null only for SUBMIT, which creates the application.
    fromStage: applicationStage("from_stage"),
    toStage: applicationStage("to_stage").notNull(),
    actorType: actorType("actor_type").notNull(),
    // A Better Auth user id, a staff id, or the name of a system job. Never
    // null, so a system job's idempotency keys are unique like anyone else's.
    actorId: text("actor_id").notNull(),
    familyVisible: boolean("family_visible").notNull(),
    // Parsed by the command's schema in @mbs/api-contract before it is written.
    payload: jsonb("payload").notNull(),
    payloadVersion: integer("payload_version").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.applicationId, table.seq),
    uniqueIndex("application_events_actor_idempotency_key")
      .on(table.actorType, table.actorId, table.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);
