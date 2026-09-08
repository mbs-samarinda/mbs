import { schema, type Database, type Transaction } from "@mbs/db";

/**
 * Append-only business history: who changed what, and when. There is no update
 * or delete counterpart, by design.
 *
 * Every domain operation that changes important state writes one of these
 * inside its own transaction, so the record and the change commit together.
 * Metadata is sanitized by the caller — never NIK, document contents or tokens.
 */
export async function appendAuditLog(
  db: Database | Transaction,
  entry: {
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: unknown;
    ipAddress?: string | null;
  },
) {
  await db.insert(schema.auditLogs).values(entry);
}
