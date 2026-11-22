import { schema, type Database } from "@mbs/db";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export async function resetTables(db: Database, tables: readonly PgTable[]) {
  const others = tables.filter((table) => table !== schema.auditLogs);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select correct_history('test reset')`);
    if (others.length < tables.length) {
      await tx.execute(sql`delete from audit_logs where action <> 'HISTORY_CORRECTION'`);
    }
    if (others.length > 0) {
      await tx.execute(
        sql`truncate ${sql.join(
          others.map((table) => sql`${table}`),
          sql`, `,
        )} cascade`,
      );
    }
  });
}
