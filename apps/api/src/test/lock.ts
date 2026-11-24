import type { Database } from "@mbs/db";
import { sql } from "drizzle-orm";

/**
 * Holds a table until `release`. The transaction ends by returning: a `commit`
 * sent inside it leaves postgres.js waiting for one that has already happened.
 */
export async function lockTable(db: Database, table: string) {
  const locked = Promise.withResolvers<null>();
  const released = Promise.withResolvers<null>();
  const unlocked = db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${sql.identifier(table)} in access exclusive mode`);
    locked.resolve(null);
    await released.promise;
  });
  await Promise.race([locked.promise, unlocked]);
  return { release: () => released.resolve(null), unlocked };
}
