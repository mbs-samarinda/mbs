import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema.ts";

// Better Auth's tables are part of the same Drizzle schema object, so the
// adapter and every query see one schema. They live in their own file because
// their shape is dictated by better-auth, not by us.
export * from "./auth-schema.ts";

export const cycleStatus = pgEnum("cycle_status", ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"]);

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Name and level are compile-time facts in @mbs/school-config, not columns.
  // Taking part in a cycle is school_admission_settings.is_enabled, not a
  // property of the school.
  key: text("key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The cycle is global across MBSS. It deliberately carries no school_id; a
// school joins a cycle through school_admission_settings.
export const admissionCycles = pgTable("admission_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  registrationOpenAt: timestamp("registration_open_at", { withTimezone: true }).notNull(),
  registrationCloseAt: timestamp("registration_close_at", { withTimezone: true }).notNull(),
  resultPublishAt: timestamp("result_publish_at", { withTimezone: true }).notNull(),
  defaultFee: integer("default_fee").notNull(),
  status: cycleStatus("status").notNull().default("DRAFT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (table) => [unique().on(table.admissionCycleId, table.schoolId)],
);

export const staffRole = pgEnum("staff_role", ["ADMINISTRATOR", "STAFF", "PRINCIPAL"]);
export const staffLoginEmailKind = pgEnum("staff_login_email_kind", ["INSTITUTIONAL", "PERSONAL"]);

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
export const staffLoginEmails = pgTable("staff_login_emails", {
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
});

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
 * Append-only business history. Application code inserts and never updates or
 * deletes. This is not the server log: it answers who changed what, and when.
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
