import { schema, type Transaction } from "@mbs/db";

const { files } = schema;

export type FileRow = typeof files.$inferSelect;

export async function insertFile(
  tx: Transaction,
  row: typeof files.$inferInsert,
): Promise<FileRow> {
  const [inserted] = await tx.insert(files).values(row).returning();
  return inserted!;
}
