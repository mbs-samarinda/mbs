import type { SchoolKey, StaffRole } from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { isSchoolKey } from "@mbs/school-config";

import { ForbiddenError, UnauthorizedError } from "../../errors.ts";
import {
  bindAuthUser,
  findSchoolKeysForStaff,
  findStaffByLoginEmail,
} from "../staff/repository.ts";

/** A proven staff identity. Holding one means the checks already passed. */
export type StaffContext = {
  readonly id: string;
  readonly name: string;
  readonly role: StaffRole;
  readonly schoolKeys: readonly SchoolKey[];
  readonly authUserId: string;
};

export type SessionUser = { id: string; email: string; emailVerified: boolean };

/**
 * Turns a Better Auth session into a staff identity, binding the login email to
 * the identity on first sign-in.
 *
 * An unapproved address, an unverified one, or an inactive profile is
 * forbidden, all with the same message: the committee's membership is not
 * something a failed sign-in should reveal.
 */
export async function resolveStaff(db: Database, user: SessionUser | null): Promise<StaffContext> {
  if (!user) throw new UnauthorizedError("Not signed in.");

  const denied = new ForbiddenError("This account has no access.");

  // Every write stores the address lowercased, so every read has to match it.
  const email = user.email.toLowerCase();

  const record = await findStaffByLoginEmail(db, email);
  if (!record || !record.isActive) throw denied;

  if (record.authUserId === null) {
    // Only a provider-verified address may claim a pre-approved row: a
    // pre-approved personal email stays unusable until ownership is proven.
    if (!user.emailVerified) throw denied;
    const bound = await bindAuthUser(db, record.loginEmailId, user.id);
    // Losing the race is fine as long as the winner was this same identity.
    if (!bound) {
      const current = await findStaffByLoginEmail(db, email);
      if (current?.authUserId !== user.id || current.verifiedAt === null) throw denied;
    }
    // An address bound earlier must also carry the verification that binding
    // recorded. A row with an identity but no verified_at was written by
    // something other than this path, and is not trusted.
  } else if (record.authUserId !== user.id || record.verifiedAt === null) {
    throw denied;
  }

  return {
    id: record.staffId,
    name: record.name,
    role: record.role,
    schoolKeys: (await findSchoolKeysForStaff(db, record.staffId)).filter(isSchoolKey),
    authUserId: user.id,
  };
}

export function requireRole(staff: StaffContext, ...roles: readonly StaffContext["role"][]): void {
  if (!roles.includes(staff.role)) throw new ForbiddenError("Not allowed.");
}

/** Role never implies a school. Both checks run, always. */
export function requireSchoolAccess(staff: StaffContext, schoolKey: SchoolKey): void {
  if (!staff.schoolKeys.includes(schoolKey)) throw new ForbiddenError("Not allowed.");
}
