import type {
  CreateStaffInput,
  SchoolKey,
  SetStaffActiveInput,
  StaffProfile,
  StaffSummary,
  UpdateStaffInput,
} from "@mbs/api-contract";
import type { Database, Transaction } from "@mbs/db";
import { isSchoolKey } from "@mbs/school-config";

import { ConflictError, ForbiddenError, NotFoundError } from "../../errors.ts";
import { requireSchoolAccess, type StaffContext } from "../auth/authorization.ts";
import {
  appendAuditLog,
  countOtherActiveAdministrators,
  findLoginEmailsForStaff,
  findSchoolIdsByKeys,
  findSchoolKeysForStaff,
  findStaffById,
  insertLoginEmail,
  insertStaff,
  listStaff,
  replaceSchoolAccess,
  updateStaff,
} from "./repository.ts";

/** Staff sign in with their institutional identity; a personal address is added later, by them. */
const INSTITUTIONAL_DOMAIN = "@mbss.sch.id";

export async function getStaffProfile(db: Database, staff: StaffContext): Promise<StaffProfile> {
  const loginEmails = await findLoginEmailsForStaff(db, staff.id);

  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    schools: [...staff.schoolKeys],
    loginEmails: loginEmails.map((row) => ({
      email: row.email,
      kind: row.kind,
      bound: row.authUserId !== null,
    })),
  };
}

/**
 * Only the profiles this administrator may act on: those whose schools all sit
 * inside their own scope. A profile with no school yet is visible to everyone,
 * because somebody has to be able to give it one.
 */
export async function listStaffProfiles(
  db: Database,
  actor: StaffContext,
): Promise<StaffSummary[]> {
  const rows = await listStaff(db);
  return rows
    .filter((row) =>
      // Checked against the raw keys: filtering to known ones first would let a
      // profile carrying an unrecognised school slip through the check.
      row.schools.every((school) => isSchoolKey(school) && actor.schoolKeys.includes(school)),
    )
    .map(toSummary);
}

export async function createStaff(
  db: Database,
  actor: StaffContext,
  input: CreateStaffInput,
): Promise<StaffSummary> {
  const email = input.email.trim().toLowerCase();
  if (!email.endsWith(INSTITUTIONAL_DOMAIN)) {
    throw new ConflictError(`A staff profile starts from a ${INSTITUTIONAL_DOMAIN} address.`);
  }

  input.schools.forEach((school) => requireSchoolAccess(actor, school));

  const staffId = await db.transaction(async (tx) => {
    const schoolIds = await resolveSchoolIds(tx, input.schools);

    const created = await insertStaff(tx, { name: input.name.trim(), role: input.role });
    // The unique index on email is what actually prevents a duplicate; a
    // pre-check would only narrow the race, not close it. Translating it here
    // keeps the database error out of the contract.
    try {
      await insertLoginEmail(tx, { staffId: created.id, email, kind: "INSTITUTIONAL" });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("That address already has a profile.");
      throw error;
    }
    await replaceSchoolAccess(tx, created.id, schoolIds);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "staff.create",
      entityType: "staff_users",
      entityId: created.id,
      metadata: { email, role: input.role, schools: input.schools },
    });

    return created.id;
  });

  return readSummary(db, staffId);
}

export async function updateStaffAccess(
  db: Database,
  actor: StaffContext,
  input: UpdateStaffInput,
): Promise<StaffSummary> {
  input.schools.forEach((school) => requireSchoolAccess(actor, school));

  await db.transaction(async (tx) => {
    const existing = await findStaffById(tx, input.staffId);
    if (!existing) throw new NotFoundError("No such staff profile.");
    const currentSchools = await requireScopeOverStaff(tx, actor, input.staffId);

    const schoolIds = await resolveSchoolIds(tx, input.schools);

    if (existing.role === "ADMINISTRATOR") {
      // Taking a school away from the last administrator locks the system just
      // as thoroughly as demoting them: they cannot widen their own scope, they
      // cannot deactivate themselves past the guard below, and bootstrap will
      // not step in while an active administrator still exists.
      const narrowing = currentSchools.some((key) => !input.schools.includes(key));
      if (input.role !== "ADMINISTRATOR" || narrowing) {
        await requireAnotherAdministrator(tx, input.staffId);
      }
    }

    await updateStaff(tx, input.staffId, { role: input.role });
    await replaceSchoolAccess(tx, input.staffId, schoolIds);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "staff.update",
      entityType: "staff_users",
      entityId: input.staffId,
      metadata: { role: input.role, schools: input.schools },
    });
  });

  return readSummary(db, input.staffId);
}

/** Access is switched off, never deleted: history keeps pointing at these identities. */
export async function setStaffActive(
  db: Database,
  actor: StaffContext,
  input: SetStaffActiveInput,
): Promise<StaffSummary> {
  await db.transaction(async (tx) => {
    const existing = await findStaffById(tx, input.staffId);
    if (!existing) throw new NotFoundError("No such staff profile.");
    await requireScopeOverStaff(tx, actor, input.staffId);

    if (!input.isActive && existing.role === "ADMINISTRATOR") {
      await requireAnotherAdministrator(tx, input.staffId);
    }

    await updateStaff(tx, input.staffId, { isActive: input.isActive });
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: input.isActive ? "staff.activate" : "staff.deactivate",
      entityType: "staff_users",
      entityId: input.staffId,
    });
  });

  return readSummary(db, input.staffId);
}

/**
 * Postgres 23505. The driver's error is not a contract, so it stops here.
 * Drizzle wraps the driver error, so the code sits on the cause.
 */
function isUniqueViolation(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}

/**
 * Losing the last administrator locks everyone out of staff management for
 * good. The count runs inside the caller's transaction and locks the rows,
 * because two administrators deactivating each other at once is exactly how
 * that happens.
 */
async function requireAnotherAdministrator(tx: Transaction, staffId: string) {
  const others = await countOtherActiveAdministrators(tx, staffId);
  if (others === 0) throw new ConflictError("MBSS would be left with no active administrator.");
}

/**
 * Granting a school you hold is not enough: the profile you are changing must
 * already sit inside your scope. Otherwise an administrator scoped to one
 * school could deactivate another school's staff, or rewrite their access to
 * their own school and take them over.
 */
async function requireScopeOverStaff(tx: Transaction, actor: StaffContext, staffId: string) {
  const current = await findSchoolKeysForStaff(tx, staffId);
  for (const key of current) {
    // A key outside the fixed list denies rather than being skipped. A scope
    // check that shrugs at what it does not recognise fails open.
    if (!isSchoolKey(key)) throw new ForbiddenError("Not allowed.");
    requireSchoolAccess(actor, key);
  }
  return current.filter(isSchoolKey);
}

async function resolveSchoolIds(tx: Transaction, keys: readonly SchoolKey[]) {
  const schools = await findSchoolIdsByKeys(tx, keys);
  if (schools.length !== keys.length) throw new NotFoundError("Unknown school.");
  return schools.map((school) => school.id);
}

async function readSummary(db: Database, staffId: string): Promise<StaffSummary> {
  const rows = await listStaff(db, staffId);
  const row = rows[0];
  if (!row) throw new NotFoundError("No such staff profile.");
  return toSummary(row);
}

function toSummary(row: Awaited<ReturnType<typeof listStaff>>[number]): StaffSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    schools: row.schools.filter(isSchoolKey),
    loginEmails: row.loginEmails,
  };
}
