import type { StaffRole } from "@mbs/api-contract";
import { schema, type Database, type Transaction } from "@mbs/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

type Executor = Database | Transaction;

/** Whether anyone has pre-approved this address for staff access. */
export async function isApprovedLoginEmail(db: Executor, email: string) {
  const rows = await db
    .select({ id: schema.staffLoginEmails.id })
    .from(schema.staffLoginEmails)
    .where(eq(schema.staffLoginEmails.email, email))
    .limit(1);

  return rows.length > 0;
}

/** The pre-approved login email and the staff profile it belongs to. */
export async function findStaffByLoginEmail(db: Executor, email: string) {
  const rows = await db
    .select({
      loginEmailId: schema.staffLoginEmails.id,
      authUserId: schema.staffLoginEmails.authUserId,
      verifiedAt: schema.staffLoginEmails.verifiedAt,
      staffId: schema.staffUsers.id,
      name: schema.staffUsers.name,
      role: schema.staffUsers.role,
      isActive: schema.staffUsers.isActive,
    })
    .from(schema.staffLoginEmails)
    .innerJoin(schema.staffUsers, eq(schema.staffUsers.id, schema.staffLoginEmails.staffId))
    .where(eq(schema.staffLoginEmails.email, email))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Claims an unbound login email for one Better Auth identity. The
 * `auth_user_id IS NULL` guard is the whole point: two first requests racing
 * each other cannot both bind, and the loser reads the winner's row.
 */
export async function bindAuthUser(db: Executor, loginEmailId: string, authUserId: string) {
  const bound = await db
    .update(schema.staffLoginEmails)
    .set({ authUserId, verifiedAt: sql`now()` })
    .where(
      and(eq(schema.staffLoginEmails.id, loginEmailId), isNull(schema.staffLoginEmails.authUserId)),
    )
    .returning({ id: schema.staffLoginEmails.id });

  return bound.length > 0;
}

export async function findSchoolKeysForStaff(db: Executor, staffId: string) {
  const rows = await db
    .select({ key: schema.schools.key })
    .from(schema.staffSchoolAccess)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.staffSchoolAccess.schoolId))
    .where(eq(schema.staffSchoolAccess.staffId, staffId))
    .orderBy(asc(schema.schools.key));

  return rows.map((row) => row.key);
}

export async function findLoginEmailsForStaff(db: Executor, staffId: string) {
  return db
    .select({
      email: schema.staffLoginEmails.email,
      kind: schema.staffLoginEmails.kind,
      authUserId: schema.staffLoginEmails.authUserId,
    })
    .from(schema.staffLoginEmails)
    .where(eq(schema.staffLoginEmails.staffId, staffId))
    .orderBy(asc(schema.staffLoginEmails.email));
}

/**
 * Staff profiles with their login emails and school keys, or one profile when
 * `staffId` is given.
 *
 * Three plain queries stitched together rather than one clever aggregate. The
 * committee is tens of people, so the round trips cost nothing, and a
 * correlated subquery written in raw SQL silently binds to the wrong column:
 * Drizzle renders the outer column reference unqualified.
 */
export async function listStaff(db: Executor, staffId?: string) {
  const staff = await db
    .select({
      id: schema.staffUsers.id,
      name: schema.staffUsers.name,
      role: schema.staffUsers.role,
      isActive: schema.staffUsers.isActive,
    })
    .from(schema.staffUsers)
    .where(staffId ? eq(schema.staffUsers.id, staffId) : undefined)
    .orderBy(asc(schema.staffUsers.name));

  if (staff.length === 0) return [];
  const ids = staff.map((row) => row.id);

  const emails = await db
    .select({
      staffId: schema.staffLoginEmails.staffId,
      email: schema.staffLoginEmails.email,
      kind: schema.staffLoginEmails.kind,
      authUserId: schema.staffLoginEmails.authUserId,
    })
    .from(schema.staffLoginEmails)
    .where(inArray(schema.staffLoginEmails.staffId, ids))
    .orderBy(asc(schema.staffLoginEmails.email));

  const access = await db
    .select({ staffId: schema.staffSchoolAccess.staffId, key: schema.schools.key })
    .from(schema.staffSchoolAccess)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.staffSchoolAccess.schoolId))
    .where(inArray(schema.staffSchoolAccess.staffId, ids))
    .orderBy(asc(schema.schools.key));

  return staff.map((row) => ({
    ...row,
    loginEmails: emails
      .filter((email) => email.staffId === row.id)
      .map((email) => ({
        email: email.email,
        kind: email.kind,
        bound: email.authUserId !== null,
      })),
    schools: access.filter((entry) => entry.staffId === row.id).map((entry) => entry.key),
  }));
}

export async function findStaffById(db: Executor, staffId: string) {
  const rows = await db
    .select({
      id: schema.staffUsers.id,
      name: schema.staffUsers.name,
      role: schema.staffUsers.role,
      isActive: schema.staffUsers.isActive,
    })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.id, staffId))
    .limit(1);

  return rows[0] ?? null;
}

export async function findSchoolIdsByKeys(db: Executor, keys: readonly string[]) {
  const rows = await db
    .select({ id: schema.schools.id, key: schema.schools.key })
    .from(schema.schools);

  return rows.filter((row) => keys.includes(row.key));
}

/**
 * Counts the active administrators other than `excludingStaffId`, locking
 * *every* active administrator row first.
 *
 * Locking only the others would not help: two transactions deactivating each
 * other would each lock the row the other is not touching, both see one
 * administrator left, and commit into an empty set. Taking the whole set in a
 * fixed order forces them to run one after the other.
 */
export async function countOtherActiveAdministrators(db: Executor, excludingStaffId: string) {
  const rows = await db
    .select({ id: schema.staffUsers.id })
    .from(schema.staffUsers)
    .where(and(eq(schema.staffUsers.role, "ADMINISTRATOR"), eq(schema.staffUsers.isActive, true)))
    .orderBy(asc(schema.staffUsers.id))
    .for("update");

  return rows.filter((row) => row.id !== excludingStaffId).length;
}

export async function insertStaff(db: Executor, values: { name: string; role: StaffRole }) {
  const rows = await db.insert(schema.staffUsers).values(values).returning();
  return rows[0]!;
}

export async function insertLoginEmail(
  db: Executor,
  values: { staffId: string; email: string; kind: "INSTITUTIONAL" | "PERSONAL" },
) {
  await db.insert(schema.staffLoginEmails).values(values);
}

export async function replaceSchoolAccess(db: Executor, staffId: string, schoolIds: string[]) {
  await db.delete(schema.staffSchoolAccess).where(eq(schema.staffSchoolAccess.staffId, staffId));
  if (schoolIds.length > 0) {
    await db
      .insert(schema.staffSchoolAccess)
      .values(schoolIds.map((schoolId) => ({ staffId, schoolId })));
  }
}

export async function updateStaff(
  db: Executor,
  staffId: string,
  values: { role?: StaffRole; isActive?: boolean },
) {
  await db
    .update(schema.staffUsers)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(schema.staffUsers.id, staffId));
}

/** Append-only. There is no update or delete counterpart, by design. */
export async function appendAuditLog(
  db: Executor,
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
