import type { Database } from "@mbs/db";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Empties tables between tests. History tables refuse TRUNCATE, and a cascade
 * reaches them from almost anywhere, so every suite resets through
 * `correct_history`, the same deliberate bypass a real correction uses.
 */
export async function resetTables(db: Database, tables: readonly PgTable[]) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select correct_history('test reset')`);
    await tx.execute(
      sql`truncate ${sql.join(
        tables.map((table) => sql`${table}`),
        sql`, `,
      )} cascade`,
    );
  });
}
