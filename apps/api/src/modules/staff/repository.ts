import type { StaffLoginEmailKind, StaffRole } from "@mbs/api-contract";
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
      id: schema.staffLoginEmails.id,
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

  const signIns = await lastStaffSignIns(
    db,
    emails.flatMap((email) => (email.authUserId ? [email.authUserId] : [])),
  );

  return staff.map((row) => ({
    ...row,
    lastSignInAt:
      emails
        .filter((email) => email.staffId === row.id && email.authUserId)
        .map((email) => signIns.get(email.authUserId!))
        .filter((at): at is Date => at !== undefined)
        .toSorted((a, b) => b.getTime() - a.getTime())[0] ?? null,
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

const STAFF_WRITES_LOCK = 4820193;

/**
 * Serializes the staff writes that check scope or the administrator count
 * (update, activate, bootstrap) until the transaction ends. Take it before the first
 * read, or a scope check can pass on a profile another save just moved. One
 * advisory lock, not row locks: the writes read overlapping sets, and row
 * locks taken in different orders deadlock.
 */
export async function lockStaffWrites(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(${STAFF_WRITES_LOCK})`);
}

/** Only meaningful while the caller holds `lockStaffWrites`. */
export async function countOtherActiveAdministrators(db: Executor, excludingStaffId: string) {
  const rows = await db
    .select({ id: schema.staffUsers.id })
    .from(schema.staffUsers)
    .where(and(eq(schema.staffUsers.role, "ADMINISTRATOR"), eq(schema.staffUsers.isActive, true)));

  return rows.filter((row) => row.id !== excludingStaffId).length;
}

export async function insertStaff(db: Executor, values: { name: string; role: StaffRole }) {
  const rows = await db.insert(schema.staffUsers).values(values).returning();
  return rows[0]!;
}

export async function insertLoginEmail(
  db: Executor,
  values: { staffId: string; email: string; kind: StaffLoginEmailKind },
) {
  const rows = await db
    .insert(schema.staffLoginEmails)
    .values(values)
    .returning({ id: schema.staffLoginEmails.id });
  return rows[0]!.id;
}

export async function deleteLoginEmails(db: Executor, ids: readonly string[]) {
  if (ids.length === 0) return;
  await db.delete(schema.staffLoginEmails).where(inArray(schema.staffLoginEmails.id, [...ids]));
}

/** Which of these addresses some profile already holds. */
export async function findTakenLoginEmails(db: Executor, emails: readonly string[]) {
  if (emails.length === 0) return [];
  const rows = await db
    .select({ email: schema.staffLoginEmails.email })
    .from(schema.staffLoginEmails)
    .where(inArray(schema.staffLoginEmails.email, [...emails]));
  return rows.map((row) => row.email);
}

/**
 * Signs these identities out of the committee app now. A session row does not
 * say which app made it, so the staff sign-in audit rows pick them out, and the
 * same person's family session stays. A session whose audit row was never
 * written survives, and the next request is still refused, because
 * `resolveStaff` reads the profile on every call.
 */
export async function endStaffSessions(db: Executor, authUserIds: readonly string[]) {
  if (authUserIds.length === 0) return;
  const ids = [...authUserIds];
  await db.delete(schema.session).where(
    and(
      inArray(schema.session.userId, ids),
      inArray(
        schema.session.id,
        db
          .select({ id: sql<string>`${schema.auditLogs.metadata}->>'sessionId'` })
          .from(schema.auditLogs)
          .where(staffSignIns(ids)),
      ),
    ),
  );
}

const staffSignIns = (authUserIds: string[]) =>
  and(
    eq(schema.auditLogs.entityType, "user"),
    inArray(schema.auditLogs.entityId, authUserIds),
    eq(schema.auditLogs.actorType, "STAFF"),
    eq(schema.auditLogs.action, "auth.sign_in"),
  );

/** The newest committee sign-in per identity, from the audit rows sign-in writes. */
async function lastStaffSignIns(db: Executor, authUserIds: string[]) {
  if (authUserIds.length === 0) return new Map<string, Date>();
  const rows = await db
    .select({
      authUserId: schema.auditLogs.entityId,
      at: sql<Date>`max(${schema.auditLogs.createdAt})`.mapWith(schema.auditLogs.createdAt),
    })
    .from(schema.auditLogs)
    .where(staffSignIns(authUserIds))
    .groupBy(schema.auditLogs.entityId);
  return new Map(rows.map((row) => [row.authUserId, row.at]));
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
  values: { name?: string; role?: StaffRole; isActive?: boolean },
) {
  await db
    .update(schema.staffUsers)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(schema.staffUsers.id, staffId));
}
