import { schema, type Transaction } from "@mbs/db";
import { eq } from "drizzle-orm";

const { files } = schema;

export type FileRow = typeof files.$inferSelect;

export async function insertFile(
  tx: Transaction,
  row: typeof files.$inferInsert,
): Promise<FileRow> {
  const [inserted] = await tx.insert(files).values(row).returning();
  return inserted!;
}

export async function findFileById(tx: Transaction, id: string): Promise<FileRow | null> {
  const [found] = await tx.select().from(files).where(eq(files.id, id)).limit(1);
  return found ?? null;
}
