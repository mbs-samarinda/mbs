import { createDatabase, schema } from "@mbs/db";
import { getTableName, ne, sql } from "drizzle-orm";
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

  const APPEND_ONLY = /audit_logs: history rows are append-only/;

  async function seedAuditRow() {
    const [row] = await db
      .insert(schema.auditLogs)
      .values({
        actorType: "STAFF",
        actorId: "someone",
        action: "cycle.create",
        entityType: "admission_cycles",
        entityId: "cycle-1",
      })
      .returning();
    return row!;
  }

  /** Every audit row except the corrections each test reset leaves behind. */
  function ordinaryRows() {
    return db
      .select()
      .from(schema.auditLogs)
      .where(ne(schema.auditLogs.action, "HISTORY_CORRECTION"));
  }

  function correctionsFor(reason: string) {
    return db.execute<{ id: string }>(
      sql`select id from audit_logs where action = 'HISTORY_CORRECTION' and metadata->>'reason' = ${reason}`,
    );
  }

  it.each([
    // Aimed at the seeded row: a whole-table statement would hit a reset's
    // correction row first and fail for that reason instead.
    ["update", sql`update audit_logs set action = 'rewritten' where action = 'cycle.create'`],
    ["delete", sql`delete from audit_logs where action = 'cycle.create'`],
    ["truncate", sql`truncate audit_logs`],
  ])("refuses %s and names the table", async (_name, statement) => {
    await seedAuditRow();

    await expect(db.execute(statement)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(APPEND_ONLY) },
    });
    expect(await ordinaryRows()).toHaveLength(1);
  });

  it("lets one transaction through correct_history and records why", async () => {
    await seedAuditRow();

    const reason = `fix a typo ${crypto.randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select correct_history(${reason})`);
      await tx.execute(
        sql`update audit_logs set action = 'cycle.created' where action = 'cycle.create'`,
      );
    });

    expect((await ordinaryRows()).map((row) => row.action)).toEqual(["cycle.created"]);
    const corrections = await db
      .select()
      .from(schema.auditLogs)
      .where(sql`${schema.auditLogs.metadata}->>'reason' = ${reason}`);
    expect(corrections).toMatchObject([{ actorType: "DATABASE", action: "HISTORY_CORRECTION" }]);

    // The gate closed with the transaction.
    await expect(
      db.execute(sql`delete from audit_logs where action = 'cycle.created'`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(APPEND_ONLY) } });
  });

  it.each([
    ["a made-up value", () => "on"],
    ["an id that is not a correction", (ownRow: string) => ownRow],
  ])("refuses a flag set by hand to %s", async (_name, flag) => {
    await expect(
      db.transaction(async (tx) => {
        // Written in this transaction, so only the action check stands between
        // this flag and an open gate.
        const [row] = await tx
          .insert(schema.auditLogs)
          .values({ actorType: "STAFF", action: "x", entityType: "x", entityId: "x" })
          .returning();
        await tx.execute(sql`select set_config('mbs.history_correction', ${flag(row!.id)}, true)`);
        await tx.execute(sql`delete from audit_logs where action = 'x'`);
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(APPEND_ONLY) } });
  });

  it("refuses an old correction's id in a later transaction", async () => {
    await seedAuditRow();
    const reason = `an earlier fix ${crypto.randomUUID()}`;
    await db.transaction((tx) => tx.execute(sql`select correct_history(${reason})`));
    const [old] = await correctionsFor(reason);

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('mbs.history_correction', ${old!.id}, true)`);
        await tx.execute(sql`delete from audit_logs where action = 'cycle.create'`);
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(APPEND_ONLY) } });
    expect(await ordinaryRows()).toHaveLength(1);
  });

  // The flag names a row whose xmin is the savepoint's own transaction id, not
  // the top-level one, so the check fails closed.
  it("refuses a correction made inside a savepoint", async () => {
    await seedAuditRow();

    await expect(
      db.transaction(async (tx) => {
        await tx.transaction((inner) => inner.execute(sql`select correct_history('nested')`));
        await tx.execute(sql`delete from audit_logs where action = 'cycle.create'`);
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(APPEND_ONLY) } });
  });

  it.each([
    ["update", sql`update audit_logs set metadata = '{}' where action = 'HISTORY_CORRECTION'`],
    ["delete", sql`delete from audit_logs where action = 'HISTORY_CORRECTION'`],
  ])("never lets a correction %s a correction's own row", async (_name, statement) => {
    const reason = `keep me ${crypto.randomUUID()}`;
    await db.transaction((tx) => tx.execute(sql`select correct_history(${reason})`));

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select correct_history('try to erase the record')`);
        await tx.execute(statement);
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/correction's own record is never changed/) },
    });
    expect(await correctionsFor(reason)).toHaveLength(1);
  });

  it("refuses to truncate audit_logs even inside a correction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select correct_history('wipe everything')`);
        await tx.execute(sql`truncate audit_logs`);
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/correction rows are kept forever/) },
    });
  });

  it("refuses a correction with no reason", async () => {
    await expect(
      db.transaction((tx) => tx.execute(sql`select correct_history('  ')`)),
    ).rejects.toThrow();
  });
});
