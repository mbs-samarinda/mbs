import type { ApplicantProfile, ApplicationCommand, CommandPayload } from "@mbs/api-contract";
import {
  ACTOR_TYPES,
  APPLICATION_COMMANDS,
  APPLICATION_STAGES,
  CYCLE_STATUSES,
  DOCUMENT_STAGES,
  DOCUMENT_TYPES,
  INTERVIEW_MODES,
  NOTIFICATION_ATTEMPT_OUTCOMES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  PAYMENT_DECISIONS,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  SIGN_IN_CODE_TEMPLATE,
  STAFF_LOGIN_EMAIL_KINDS,
  STAFF_ROLES,
} from "@mbs/school-config";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
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
    // One account for every school, because the foundation collects for all three.
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountHolder: text("bank_account_holder"),
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
    // No cycle-wide default: each school sets its own, usually after registration opens.
    reregistrationFee: integer("reregistration_fee"),
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
    stage: documentStage("stage").notNull().default("REGISTRATION"),
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

/**
 * The agreement a family accepts at registrasi ulang. It belongs to the school,
 * not the cycle, so next year's cycle starts from the same text. Saving new text
 * adds a version and never edits one, because an acceptance points at the exact
 * version the family saw.
 */
export const schoolAgreementVersions = pgTable(
  "school_agreement_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    createdByStaffId: uuid("created_by_staff_id")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.schoolId, table.version)],
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
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
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
  },
  // An application's page reads its rows, and the table grows with every
  // sign-in, view and status check.
  (table) => [index("audit_logs_entity").on(table.entityType, table.entityId, table.createdAt)],
);

export const applicationStage = pgEnum("application_stage", APPLICATION_STAGES);
export const applicationCommand = pgEnum("application_command", APPLICATION_COMMANDS);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const interviewMode = pgEnum("interview_mode", INTERVIEW_MODES);

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
    registrationSeq: integer("registration_seq").notNull(),
    registrationNumber: text("registration_number").notNull(),
    stage: applicationStage("stage").notNull(),
    interviewMode: interviewMode("interview_mode"),
    nik: text("nik").notNull(),
    registrationFee: integer("registration_fee").notNull(),
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
    unique("applications_cycle_school_nik_unique").on(
      table.admissionCycleId,
      table.schoolId,
      table.nik,
    ),
    check("applications_nik_digits", sql`nik ~ '^[0-9]{16}$'`),
  ],
);

/**
 * Tries to check a status without an account, for a day. A wrong try is two rows,
 * `ADDRESS <address>` and `NUMBER <number>`, and a right one is `RIGHT <address>`.
 * The number is in its canonical form, never the text as typed, which can be a
 * NIK in the wrong field. Kept apart from `rate_limit`, where sign-in deletes
 * every row after an hour.
 */
export const statusCheckTries = pgTable(
  "status_check_tries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("status_check_tries_subject").on(table.subject, table.createdAt),
    index("status_check_tries_age").on(table.createdAt),
  ],
);

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

export const applicantProfileVersions = pgTable(
  "applicant_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    version: integer("version").notNull(),
    data: jsonb("data").$type<ApplicantProfile>().notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.applicationId, table.version)],
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    seq: integer("seq").notNull(),
    command: applicationCommand("command").notNull(),
    fromStage: applicationStage("from_stage"),
    toStage: applicationStage("to_stage").notNull(),
    actorType: actorType("actor_type").notNull(),
    // Never null, so a system job's idempotency keys are unique like anyone
    // else's.
    actorId: text("actor_id").notNull(),
    familyVisible: boolean("family_visible").notNull(),
    payload: jsonb("payload").$type<CommandPayload<ApplicationCommand>>().notNull(),
    payloadVersion: integer("payload_version").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.applicationId, table.seq),
    check(
      "application_events_only_submit_lacks_from_stage",
      sql`(from_stage is null) = (command = 'SUBMIT')`,
    ),
    uniqueIndex("application_events_actor_idempotency_key")
      .on(table.actorType, table.actorId, table.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    // The committee's newest activity reads from the newest end and stops early.
    index("application_events_created_at").on(table.createdAt),
  ],
);

export const paymentPurpose = pgEnum("payment_purpose", PAYMENT_PURPOSES);
export const paymentMethod = pgEnum("payment_method", PAYMENT_METHODS);
export const paymentDecision = pgEnum("payment_decision", PAYMENT_DECISIONS);

/**
 * One object in the bucket. The row is written after the browser's upload
 * lands, so `byteSize` is what the bucket reports, not what the browser
 * promised. Bytes never pass through the API.
 */
export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Random, and never built from a name, NIK or registration number: the key
  // travels in URLs and bucket listings.
  objectKey: text("object_key").notNull().unique(),
  byteSize: integer("byte_size").notNull(),
  contentType: text("content_type").notNull(),
  sha256: text("sha256").notNull(),
  uploadedByUserId: text("uploaded_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One attempt to pay. A second proof after a rejection is a new row, so the
 * rejected attempt keeps its proof and its reason forever.
 *
 * `amountDue` is copied from the application's own fee snapshot, because a
 * later fee change must not rewrite what this family was asked for.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    purpose: paymentPurpose("purpose").notNull(),
    amountDue: integer("amount_due").notNull(),
    method: paymentMethod("method").notNull(),
    // One file per attempt, and a file is never reused by a second attempt.
    fileId: uuid("file_id")
      .notNull()
      .unique()
      .references(() => files.id),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The desk reads one application's attempts newest first.
  (table) => [index("payments_application").on(table.applicationId, table.createdAt)],
);

/**
 * The committee's decision on one proof. Its own table rather than columns on
 * `payments`, because a decision is never edited and the history trigger
 * forbids the update that storing it in place would need. `paymentId` is unique,
 * so two staff deciding at once end with one decision and one refusal.
 */
export const paymentReviews = pgTable(
  "payment_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    decision: paymentDecision("decision").notNull(),
    reason: text("reason"),
    reviewedByStaffId: uuid("reviewed_by_staff_id")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("payment_reviews_reason_kept", sql`(reason is not null) = (decision = 'REJECTED')`)],
);

export const notificationChannel = pgEnum("notification_channel", NOTIFICATION_CHANNELS);
export const notificationStatus = pgEnum("notification_status", NOTIFICATION_STATUSES);
export const notificationAttemptOutcome = pgEnum(
  "notification_attempt_outcome",
  NOTIFICATION_ATTEMPT_OUTCOMES,
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").references(() => applications.id),
    eventId: uuid("event_id").references(() => applicationEvents.id),
    userId: text("user_id").references(() => user.id),
    channel: notificationChannel("channel").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    status: notificationStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_event_user")
      .on(table.eventId, table.userId)
      .where(sql`event_id is not null`),
    index("notifications_due")
      .on(table.nextAttemptAt)
      .where(sql`status in ('PENDING', 'SENDING')`),
    index("notifications_codes")
      .on(table.recipient, table.createdAt)
      .where(sql`template_key = ${sql.raw(`'${SIGN_IN_CODE_TEMPLATE}'`)}`),
    check(
      "notifications_event_kept",
      sql`case when template_key = ${sql.raw(`'${SIGN_IN_CODE_TEMPLATE}'`)}
        then application_id is null and event_id is null
        else application_id is not null and event_id is not null end`,
    ),
    check(
      "notifications_content_kept",
      sql`case when template_key = ${sql.raw(`'${SIGN_IN_CODE_TEMPLATE}'`)}
        then subject is null and body_text is null and body_html is null
        else subject is not null and body_text is not null end`,
    ),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id),
    attempt: integer("attempt").notNull(),
    outcome: notificationAttemptOutcome("outcome").notNull(),
    responseCode: text("response_code"),
    errorClass: text("error_class"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.notificationId, table.attempt)],
);
