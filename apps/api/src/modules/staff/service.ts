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

import {
  ConflictError,
  EmailTakenError,
  ForbiddenError,
  isUniqueViolation,
  LastAdministratorError,
  NotFoundError,
} from "../../errors.ts";
import { appendAuditLog } from "../audit.ts";
import { requireSchoolAccess, type StaffContext } from "../auth/authorization.ts";
import {
  countOtherActiveAdministrators,
  deleteLoginEmails,
  endStaffSessions,
  findLoginEmailsForStaff,
  findSchoolIdsByKeys,
  findSchoolKeysForStaff,
  findStaffById,
  findTakenLoginEmails,
  insertLoginEmail,
  insertStaff,
  listStaff,
  lockStaffWrites,
  replaceSchoolAccess,
  updateStaff,
} from "./repository.ts";

/** Staff sign in with their institutional identity; a personal address is added later, by them. */
const INSTITUTIONAL_DOMAIN = "@mbss.sch.id";

export function loginEmailKind(email: string) {
  return email.endsWith(INSTITUTIONAL_DOMAIN) ? "INSTITUTIONAL" : "PERSONAL";
}

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
 * because somebody has to be able to give it one. A profile with no address is
 * left out: nobody can sign in as it, and ppdb-sim keeps one to name its actor.
 */
export async function listStaffProfiles(
  db: Database,
  actor: StaffContext,
): Promise<StaffSummary[]> {
  const rows = await listStaff(db);
  return rows
    .filter(
      (row) =>
        row.loginEmails.length > 0 &&
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
  requireInstitutionalAddress(input.emails);
  input.schools.forEach((school) => requireSchoolAccess(actor, school));

  const staffId = await db.transaction(async (tx) => {
    const schoolIds = await resolveSchoolIds(tx, input.schools);
    await requireFreeAddresses(tx, input.emails);

    const created = await insertStaff(tx, { name: input.name, role: input.role });
    const added = await addLoginEmails(tx, created.id, input.emails);
    await replaceSchoolAccess(tx, created.id, schoolIds);
    // Ids, never addresses or the name: audit rows hold no personal data.
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "staff.create",
      entityType: "staff_users",
      entityId: created.id,
      metadata: { role: input.role, schools: input.schools, loginEmails: { added } },
    });

    return created.id;
  });

  return readSummary(db, staffId);
}

/**
 * Saves the whole side panel. Removing an address signs it out of the
 * committee app at once, as deactivating does.
 */
export async function updateStaffProfile(
  db: Database,
  actor: StaffContext,
  input: UpdateStaffInput,
): Promise<StaffSummary> {
  requireInstitutionalAddress(input.emails);
  input.schools.forEach((school) => requireSchoolAccess(actor, school));

  await db.transaction(async (tx) => {
    await lockStaffWrites(tx);
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

    const emails = await findLoginEmailsForStaff(tx, input.staffId);
    const removed = emails.filter((row) => !input.emails.includes(row.email));
    const kept = new Set(emails.map((row) => row.email));
    const fresh = input.emails.filter((email) => !kept.has(email));
    await requireFreeAddresses(tx, fresh);

    await deleteLoginEmails(
      tx,
      removed.map((row) => row.id),
    );
    await endStaffSessions(
      tx,
      removed.flatMap((row) => (row.authUserId ? [row.authUserId] : [])),
    );
    const added = await addLoginEmails(tx, input.staffId, fresh);
    await updateStaff(tx, input.staffId, { name: input.name, role: input.role });
    await replaceSchoolAccess(tx, input.staffId, schoolIds);

    const changes = {
      ...(existing.name !== input.name && { name: "changed" }),
      ...(existing.role !== input.role && { role: { from: existing.role, to: input.role } }),
      ...(schoolSet(currentSchools) !== schoolSet(input.schools) && {
        schools: { from: currentSchools, to: input.schools },
      }),
      ...((added.length > 0 || removed.length > 0) && {
        loginEmails: { added, removed: removed.map((row) => row.id) },
      }),
    };
    if (Object.keys(changes).length === 0) return;
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "staff.update",
      entityType: "staff_users",
      entityId: input.staffId,
      metadata: changes,
    });
  });

  return readSummary(db, input.staffId);
}

/**
 * Access is switched off, never deleted: history keeps pointing at these
 * identities. Switching off also ends their committee sessions, so the person
 * is out at once rather than at their next click.
 */
export async function setStaffActive(
  db: Database,
  actor: StaffContext,
  input: SetStaffActiveInput,
): Promise<StaffSummary> {
  await db.transaction(async (tx) => {
    await lockStaffWrites(tx);
    const existing = await findStaffById(tx, input.staffId);
    if (!existing) throw new NotFoundError("No such staff profile.");
    await requireScopeOverStaff(tx, actor, input.staffId);

    if (!input.isActive && existing.role === "ADMINISTRATOR") {
      await requireAnotherAdministrator(tx, input.staffId);
    }

    await updateStaff(tx, input.staffId, { isActive: input.isActive });
    if (!input.isActive) {
      const emails = await findLoginEmailsForStaff(tx, input.staffId);
      await endStaffSessions(
        tx,
        emails.flatMap((row) => (row.authUserId ? [row.authUserId] : [])),
      );
    }
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

const schoolSet = (keys: readonly string[]) => keys.toSorted().join(",");

/** A profile keeps one school address, because a personal one is only ever added to it. */
function requireInstitutionalAddress(emails: readonly string[]) {
  if (!emails.some((email) => loginEmailKind(email) === "INSTITUTIONAL")) {
    throw new ConflictError(`A staff profile keeps a ${INSTITUTIONAL_DOMAIN} address.`);
  }
}

/**
 * Names the address that is taken, so the form can point at it. The unique
 * index is still what prevents a duplicate: this only narrows the race.
 */
async function requireFreeAddresses(tx: Transaction, emails: readonly string[]) {
  const [taken] = await findTakenLoginEmails(tx, emails);
  if (taken) throw new EmailTakenError(taken);
}

async function addLoginEmails(tx: Transaction, staffId: string, emails: readonly string[]) {
  const ids: string[] = [];
  for (const email of emails) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const id = await insertLoginEmail(tx, { staffId, email, kind: loginEmailKind(email) }).catch(
      (error: unknown) => {
        if (isUniqueViolation(error)) throw new EmailTakenError(email);
        throw error;
      },
    );
    ids.push(id);
  }
  return ids;
}

/** The caller holds `lockStaffWrites`, or two administrators deactivating each other both pass. */
async function requireAnotherAdministrator(tx: Transaction, staffId: string) {
  const others = await countOtherActiveAdministrators(tx, staffId);
  if (others === 0) {
    throw new LastAdministratorError("MBSS would be left with no active administrator.");
  }
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
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
  };
}
