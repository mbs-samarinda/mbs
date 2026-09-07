import { schema, type Database, type Transaction } from "@mbs/db";
import { SCHOOL_KEYS } from "@mbs/school-config";
import { and, eq, sql } from "drizzle-orm";

import { findSchoolIdsByKeys, replaceSchoolAccess } from "./repository.ts";

/**
 * Ensures one administrator exists so the staff page has somebody to sign in
 * and use it. Nothing can grant staff access before the first administrator,
 * which makes this a chicken-and-egg problem no UI can solve.
 *
 * Idempotent. It leaves an existing profile alone — including one an
 * administrator deliberately deactivated — with one exception: if no active
 * administrator is left anywhere, it restores this one, because at that point
 * nobody can sign in to fix it.
 */
export async function ensureBootstrapAdministrator(db: Database, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();

  return db.transaction(async (tx) => {
    // Two API instances booting together would both read no rows and both
    // insert, and the loser dies on a unique violation before it can listen.
    // The lock is held until this transaction commits. The number is arbitrary
    // and only has to be the same in every instance.
    await tx.execute(sql`select pg_advisory_xact_lock(4820193)`);

    const activeAdministrators = await tx
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(
        and(eq(schema.staffUsers.role, "ADMINISTRATOR"), eq(schema.staffUsers.isActive, true)),
      );

    const existing = await tx
      .select({ staffId: schema.staffLoginEmails.staffId })
      .from(schema.staffLoginEmails)
      .where(eq(schema.staffLoginEmails.email, email))
      .limit(1);

    if (existing.length > 0) {
      // Normally leave the profile alone. The exception is the state nothing
      // else can escape: no active administrator anywhere, so no session can
      // reach the staff page to restore one.
      if (activeAdministrators.length > 0) return { created: false, restored: false, email };

      await tx
        .update(schema.staffUsers)
        .set({ role: "ADMINISTRATOR", isActive: true, updatedAt: sql`now()` })
        .where(eq(schema.staffUsers.id, existing[0]!.staffId));

      // The schools come back too. Somebody may have narrowed this profile to
      // one school before it was deactivated, and an administrator cannot widen
      // their own scope — restoring the role alone would be a permanent partial
      // lockout produced by the escape hatch itself.
      await replaceSchoolAccess(
        tx,
        existing[0]!.staffId,
        (await requireSchools(tx)).map((school) => school.id),
      );

      await tx.insert(schema.auditLogs).values({
        actorType: "SYSTEM",
        actorId: null,
        action: "staff.bootstrap_restore",
        entityType: "staff_users",
        entityId: existing[0]!.staffId,
        metadata: { email },
      });

      return { created: false, restored: true, email };
    }

    const schools = await requireSchools(tx);

    const [staff] = await tx
      .insert(schema.staffUsers)
      // No name is known yet; the address is the only honest label until this
      // person signs in and an administrator corrects it.
      .values({ name: email, role: "ADMINISTRATOR" })
      .returning({ id: schema.staffUsers.id });

    await tx
      .insert(schema.staffLoginEmails)
      .values({ staffId: staff!.id, email, kind: "INSTITUTIONAL" });

    await replaceSchoolAccess(
      tx,
      staff!.id,
      schools.map((school) => school.id),
    );

    await tx.insert(schema.auditLogs).values({
      actorType: "SYSTEM",
      actorId: null,
      action: "staff.bootstrap",
      entityType: "staff_users",
      entityId: staff!.id,
      metadata: { email },
    });

    return { created: true, restored: false, email };
  });
}

async function requireSchools(tx: Transaction) {
  const schools = await findSchoolIdsByKeys(tx, SCHOOL_KEYS);
  if (schools.length !== SCHOOL_KEYS.length) {
    throw new Error("Schools are missing. Run the migrations before starting the API.");
  }
  return schools;
}
