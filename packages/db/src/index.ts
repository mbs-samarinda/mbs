import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.ts";

export * as schema from "./schema.ts";

/**
 * Builds the database client from a URL the calling application already
 * validated. This package never reads process.env at runtime.
 */
export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 10,
    // Without limits a database that stops answering hangs each request until
    // the client gives up, instead of failing it with a logged error.
    connect_timeout: 10,
    connection: { statement_timeout: 15_000 },
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

/**
 * The handle inside `db.transaction(...)`. Drizzle names no type for it, and
 * spelling the lookup out at each call site put an unreadable incantation in
 * three files.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
