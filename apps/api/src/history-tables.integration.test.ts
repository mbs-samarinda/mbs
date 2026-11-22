import { createDatabase, schema } from "@mbs/db";
import { getTableName, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTables } from "./test/reset.ts";

/**
 * Every table whose rows describe the past. A new append-only table joins this
 * list in the change that creates it, and its migration attaches
 * `forbid_history_change()`.
 */
const HISTORY_TABLES = [
  schema.auditLogs,
  schema.applicationEvents,
  schema.applicantProfileVersions,
  schema.applicationDocumentRequirements,
].map((table) => getTableName(table));

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

afterAll(() => db.$client.end());

// pg_trigger.tgtype is a bit mask. These are the bits from Postgres's
// catalog/pg_trigger.h.
const ROW = 1;
const BEFORE = 2;
const DELETE = 8;
const UPDATE = 16;
const TRUNCATE = 32;

type GuardTrigger = { table: string; tgtype: number };

async function guardTriggers() {
  const rows = await db.execute<GuardTrigger>(sql`
    select c.relname as "table", t.tgtype::int as tgtype
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where t.tgfoid = 'forbid_history_change'::regproc
      and t.tgenabled <> 'D'
  `);
  return [...rows];
}

function has(triggers: GuardTrigger[], table: string, bits: number) {
  return triggers.some((trigger) => trigger.table === table && (trigger.tgtype & bits) === bits);
}

describe("the history tables", () => {
  it.each(HISTORY_TABLES)("%s refuses update, delete and truncate", async (table) => {
    const triggers = await guardTriggers();

    expect(has(triggers, table, ROW | BEFORE | UPDATE | DELETE)).toBe(true);
    expect(has(triggers, table, BEFORE | TRUNCATE)).toBe(true);
  });

  // The other direction: a guarded table missing from the list means the list
  // stopped being the record of what is append-only.
  it("lists every table that carries the guard", async () => {
    const guarded = new Set((await guardTriggers()).map((trigger) => trigger.table));

    expect([...guarded].toSorted()).toEqual(HISTORY_TABLES.toSorted());
  });
});

describe("forbid_history_change", () => {
  beforeEach(() => resetTables(db, [schema.auditLogs]));

  async function seedAuditRow() {
    await db.insert(schema.auditLogs).values({
      actorType: "STAFF",
      actorId: "someone",
      action: "cycle.create",
      entityType: "admission_cycles",
      entityId: "cycle-1",
    });
  }

  it.each([
    ["update", sql`update audit_logs set action = 'rewritten'`],
    ["delete", sql`delete from audit_logs`],
    ["truncate", sql`truncate audit_logs`],
  ])("refuses %s and names the table", async (_name, statement) => {
    await seedAuditRow();

    await expect(db.execute(statement)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/audit_logs: history rows are append-only/) },
    });
    expect(await db.$count(schema.auditLogs)).toBe(1);
  });

  it("lets one transaction through correct_history and records why", async () => {
    await seedAuditRow();

    await db.transaction(async (tx) => {
      await tx.execute(sql`select correct_history('fix a typo in the action name')`);
      await tx.execute(
        sql`update audit_logs set action = 'cycle.created' where action = 'cycle.create'`,
      );
    });

    const rows = await db.select().from(schema.auditLogs);
    expect(rows.map((row) => row.action).toSorted()).toEqual([
      "HISTORY_CORRECTION",
      "cycle.created",
    ]);
    expect(rows.find((row) => row.action === "HISTORY_CORRECTION")).toMatchObject({
      actorType: "DATABASE",
      metadata: { reason: "fix a typo in the action name" },
    });

    // The gate closed with the transaction.
    await expect(db.execute(sql`delete from audit_logs`)).rejects.toThrow();
  });

  it("refuses a correction with no reason", async () => {
    await expect(
      db.transaction((tx) => tx.execute(sql`select correct_history('  ')`)),
    ).rejects.toThrow();
  });
});
