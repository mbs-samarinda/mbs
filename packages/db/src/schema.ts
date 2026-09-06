import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const cycleStatus = pgEnum("cycle_status", ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"]);

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  level: text("level").notNull(),
  isActive: boolean("is_active").notNull().default(true),
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
