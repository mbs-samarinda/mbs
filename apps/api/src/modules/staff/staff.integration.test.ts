import { createDatabase, schema } from "@mbs/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "../../errors.ts";
import { testConfig } from "../../test/config.ts";
import { resetTables } from "../../test/reset.ts";
import { createStaffAuth, sessionCookie } from "../auth/auth.ts";
import { resolveStaff, type StaffContext } from "../auth/authorization.ts";
import { ensureBootstrapAdministrator } from "./bootstrap.ts";
import {
  findSchoolIdsByKeys,
  insertStaff,
  isApprovedLoginEmail,
  listStaff,
  lockStaffWrites,
  replaceSchoolAccess,
} from "./repository.ts";
import { createStaff, listStaffProfiles, setStaffActive, updateStaffProfile } from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

const config = testConfig();

const BOOTSTRAP_EMAIL = "kepala@mbss.sch.id";

// The service records who acted; nothing in these tests depends on the actor
// being one of the rows under test.
const actor: StaffContext = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "Test actor",
  role: "ADMINISTRATOR",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-actor",
};

async function seedAuthUser(id: string, email: string, emailVerified = true) {
  await db
    .insert(schema.user)
    .values({ id, name: email, email, emailVerified, updatedAt: new Date() })
    .onConflictDoNothing();
  return { id, email, emailVerified };
}

beforeEach(async () => {
  // Schools are seeded by migration 0003 and other suites truncate them, so
  // put them back rather than assuming.
  await resetTables(db, [
    schema.auditLogs,
    schema.staffSchoolAccess,
    schema.staffLoginEmails,
    schema.staffUsers,
    schema.session,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
});

afterAll(() => db.$client.end());

/** The side panel sends the whole profile. These tests change only role and schools. */
async function updateAccess(
  database: typeof db,
  who: StaffContext,
  input: {
    staffId: string;
    role: StaffContext["role"];
    schools: StaffContext["schoolKeys"][number][];
  },
) {
  const [current] = await listStaff(database, input.staffId);
  return updateStaffProfile(database, who, {
    ...input,
    name: current!.name,
    emails: current!.loginEmails.map((row) => row.email),
  });
}

/** Signs a staff identity in the way the app does, so the sign-in audit row is written. */
async function signIn(email: string) {
  const auth = createStaffAuth(db, config, {});
  const context = await auth.$context;
  const { user } = await context.internalAdapter.createOAuthUser(
    { email, name: email, emailVerified: true },
    { providerId: "google", accountId: `google-${email}` },
  );
  await resolveStaff(db, user);
  await sessionCookie(auth, user.id);
  return user;
}

const sessionsOf = (userId: string) =>
  db.select().from(schema.session).where(eq(schema.session.userId, userId));

const staffAuditRows = () =>
  db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityType, "staff_users"))
    .orderBy(asc(schema.auditLogs.createdAt));

/** Resolves once some session on this database is blocked waiting for a lock. */
async function waitForLockWait() {
  for (let waited = 0; waited < 3_000; waited += 20) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const [row] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (row?.waiting) return;
    // oxlint-disable-next-line eslint/no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("nothing ever waited for a lock");
}

describe("ensureBootstrapAdministrator", () => {
  it("files a non-institutional address as personal", async () => {
    await ensureBootstrapAdministrator(db, "kepala@gmail.com");

    const [staff] = await listStaffProfiles(db, actor);
    expect(staff?.loginEmails).toEqual([
      { email: "kepala@gmail.com", kind: "PERSONAL", bound: false },
    ]);
  });

  it("creates one administrator with every school", async () => {
    expect(await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL)).toEqual({
      created: true,
      restored: false,
      email: BOOTSTRAP_EMAIL,
    });

    const [staff] = await listStaffProfiles(db, actor);
    expect(staff?.role).toBe("ADMINISTRATOR");
    expect(staff?.schools).toEqual(["sma", "smk", "smp"]);
  });

  it("changes nothing on a second boot", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    expect(await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL)).toEqual({
      created: false,
      restored: false,
      email: BOOTSTRAP_EMAIL,
    });
    expect(await listStaffProfiles(db, actor)).toHaveLength(1);
  });

  it("leaves a deactivated profile alone while another administrator remains", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const [staff] = await listStaffProfiles(db, actor);
    await createStaff(db, actor, {
      name: "Administrator kedua",
      emails: ["admin2@mbss.sch.id"],
      role: "ADMINISTRATOR",
      schools: ["sma"],
    });
    await db
      .update(schema.staffUsers)
      .set({ isActive: false })
      .where(eq(schema.staffUsers.id, staff!.id));

    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);

    const rows = await listStaffProfiles(db, actor);
    expect(rows.find((row) => row.id === staff!.id)?.isActive).toBe(false);
  });

  // Otherwise a system with no active administrator can only be repaired with
  // hand-written SQL: no session can reach the staff page to restore one.
  it("restores itself when no active administrator is left", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    await db.update(schema.staffUsers).set({ isActive: false, role: "STAFF" });

    expect(await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL)).toEqual({
      created: false,
      restored: true,
      email: BOOTSTRAP_EMAIL,
    });

    const [after] = await listStaffProfiles(db, actor);
    expect(after?.isActive).toBe(true);
    expect(after?.role).toBe("ADMINISTRATOR");
  });

  // An administrator cannot widen their own scope, so restoring the role
  // without the schools would be a lockout the escape hatch itself created.
  it("restores every school, not just the role", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const [staff] = await listStaffProfiles(db, actor);

    // A second administrator can legitimately narrow the first, since they are
    // not the last one at that moment. Both then go inactive.
    await createStaff(db, actor, {
      name: "Administrator kedua",
      emails: ["admin2@mbss.sch.id"],
      role: "ADMINISTRATOR",
      schools: ["sma", "smk", "smp"],
    });
    await updateAccess(db, actor, {
      staffId: staff!.id,
      role: "ADMINISTRATOR",
      schools: ["sma"],
    });
    await db.update(schema.staffUsers).set({ isActive: false });

    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);

    const restored = (await listStaffProfiles(db, actor)).find((row) => row.id === staff!.id);
    expect(restored?.schools).toEqual(["sma", "smk", "smp"]);
  });
});

// The gate Better Auth calls before it creates a user row, so an unapproved
// Google account never becomes an identity at all.
describe("isApprovedLoginEmail", () => {
  it("accepts an address an administrator pre-approved", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    expect(await isApprovedLoginEmail(db, BOOTSTRAP_EMAIL)).toBe(true);
  });

  it("rejects anything else", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    expect(await isApprovedLoginEmail(db, "stranger@example.com")).toBe(false);
  });

  // Approval is not activation: the address still resolves to nothing usable,
  // which resolveStaff enforces separately.
  it("still accepts the address of a deactivated profile", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    await db.update(schema.staffUsers).set({ isActive: false });
    expect(await isApprovedLoginEmail(db, BOOTSTRAP_EMAIL)).toBe(true);
  });
});

describe("resolveStaff", () => {
  it("binds the identity on first sign-in and reuses it afterwards", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const user = await seedAuthUser("auth-kepala", BOOTSTRAP_EMAIL);

    const first = await resolveStaff(db, user);
    expect(first.role).toBe("ADMINISTRATOR");

    const [row] = await db
      .select({ authUserId: schema.staffLoginEmails.authUserId })
      .from(schema.staffLoginEmails)
      .where(eq(schema.staffLoginEmails.email, BOOTSTRAP_EMAIL));
    expect(row?.authUserId).toBe("auth-kepala");

    expect((await resolveStaff(db, user)).id).toBe(first.id);
  });

  it("refuses a bound row that carries no verification", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const user = await seedAuthUser("auth-kepala", BOOTSTRAP_EMAIL);
    await db.update(schema.staffLoginEmails).set({ authUserId: user.id, verifiedAt: null });

    await expect(resolveStaff(db, user)).rejects.toThrow(/no access/);
  });

  // Pins Better Auth's lowercasing; our code no longer lowercases.
  it("matches a pre-approved address whatever case the provider sends", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const auth = await createStaffAuth(db, config, {}).$context;
    const { user } = await auth.internalAdapter.createOAuthUser(
      { email: "Kepala@MBSS.sch.id", name: "Kepala", emailVerified: true },
      { providerId: "google", accountId: "google-kepala" },
    );

    expect((await resolveStaff(db, user)).role).toBe("ADMINISTRATOR");
  });

  it("refuses to store an address that is not lowercase", async () => {
    const staff = await insertStaff(db, { name: "Panitia", role: "STAFF" });
    await expect(
      db
        .insert(schema.staffLoginEmails)
        .values({ staffId: staff.id, email: "Panitia@mbss.sch.id", kind: "INSTITUTIONAL" }),
    ).rejects.toMatchObject({ cause: { constraint_name: "staff_login_emails_email_lowercase" } });
  });

  it("refuses an address nobody approved", async () => {
    const user = await seedAuthUser("auth-stranger", "stranger@example.com");
    await expect(resolveStaff(db, user)).rejects.toThrow(/no access/);
  });

  it("refuses a deactivated profile", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    await db.update(schema.staffUsers).set({ isActive: false });
    const user = await seedAuthUser("auth-kepala", BOOTSTRAP_EMAIL);

    await expect(resolveStaff(db, user)).rejects.toThrow(/no access/);
  });

  it("refuses a second identity claiming a bound address", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    await resolveStaff(db, await seedAuthUser("auth-kepala", BOOTSTRAP_EMAIL));

    const impostor = { id: "auth-other", email: BOOTSTRAP_EMAIL, emailVerified: true };
    await expect(resolveStaff(db, impostor)).rejects.toThrow(/no access/);
  });

  it("keeps a pre-approved address unusable until the provider verified it", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const user = await seedAuthUser("auth-kepala", BOOTSTRAP_EMAIL, false);

    await expect(resolveStaff(db, user)).rejects.toThrow(/no access/);
  });
});

describe("staff management", () => {
  beforeEach(() => ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL));

  it("adds a staff member scoped to one school", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia SMK",
      emails: ["panitia.smk@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });

    expect(created.schools).toEqual(["smk"]);
    expect(created.loginEmails).toEqual([
      { email: "panitia.smk@mbss.sch.id", kind: "INSTITUTIONAL", bound: false },
    ]);
  });

  // An ADMINISTRATOR scoped to one school is a legal state, and granting
  // access to a school they do not hold would be a way around that scope.
  it("refuses to grant a school the acting administrator does not hold", async () => {
    const scoped = { ...actor, schoolKeys: ["smk"] as const };

    await expect(
      createStaff(db, scoped, {
        name: "Panitia SMA",
        emails: ["panitia.sma@mbss.sch.id"],
        role: "STAFF",
        schools: ["sma"],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  // An administrator scoped to one school must not reach staff who work in
  // another, in any direction.
  it("refuses to deactivate a profile outside the acting administrator's scope", async () => {
    const target = await createStaff(db, actor, {
      name: "Panitia SMA",
      emails: ["panitia.sma@mbss.sch.id"],
      role: "STAFF",
      schools: ["sma"],
    });
    const scoped = { ...actor, schoolKeys: ["smk"] as const };

    await expect(
      setStaffActive(db, scoped, { staffId: target.id, isActive: false }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses to rewrite a profile outside the acting administrator's scope", async () => {
    const target = await createStaff(db, actor, {
      name: "Panitia SMA",
      emails: ["panitia.sma@mbss.sch.id"],
      role: "STAFF",
      schools: ["sma"],
    });
    const scoped = { ...actor, schoolKeys: ["smk"] as const };

    await expect(
      updateAccess(db, scoped, { staffId: target.id, role: "STAFF", schools: ["smk"] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("hides profiles outside the acting administrator's scope from the list", async () => {
    await createStaff(db, actor, {
      name: "Panitia SMA",
      emails: ["panitia.sma@mbss.sch.id"],
      role: "STAFF",
      schools: ["sma"],
    });
    const scoped = { ...actor, schoolKeys: ["smk"] as const };

    const visible = await listStaffProfiles(db, scoped);
    expect(visible.map((row) => row.name)).not.toContain("Panitia SMA");
  });

  it("reports a duplicate address as a conflict rather than a server error", async () => {
    const values = {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF" as const,
      schools: ["smk" as const],
    };
    await createStaff(db, actor, values);

    await expect(createStaff(db, actor, values)).rejects.toThrow(ConflictError);
  });

  it("refuses an address outside the institutional domain", async () => {
    await expect(
      createStaff(db, actor, {
        name: "Panitia",
        emails: ["panitia@gmail.com"],
        role: "STAFF",
        schools: ["smk"],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses to deactivate the only administrator", async () => {
    const [administrator] = await listStaffProfiles(db, actor);

    await expect(
      setStaffActive(db, actor, { staffId: administrator!.id, isActive: false }),
    ).rejects.toThrow(/no active administrator/);
  });

  it("refuses to demote the only administrator", async () => {
    const [administrator] = await listStaffProfiles(db, actor);

    await expect(
      updateAccess(db, actor, {
        staffId: administrator!.id,
        role: "STAFF",
        schools: ["sma"],
      }),
    ).rejects.toThrow(/no active administrator/);
  });

  // Narrowing the last administrator's schools is the same lockout as demoting
  // them: they cannot widen their own scope afterwards, and bootstrap will not
  // step in while they are still active.
  it("refuses to take a school from the only administrator", async () => {
    const [administrator] = await listStaffProfiles(db, actor);

    await expect(
      updateAccess(db, actor, {
        staffId: administrator!.id,
        role: "ADMINISTRATOR",
        schools: ["sma"],
      }),
    ).rejects.toThrow(/no active administrator/);
  });

  it("allows narrowing once a second administrator exists", async () => {
    const [administrator] = await listStaffProfiles(db, actor);
    await createStaff(db, actor, {
      name: "Administrator kedua",
      emails: ["admin2@mbss.sch.id"],
      role: "ADMINISTRATOR",
      schools: ["sma", "smk", "smp"],
    });

    const updated = await updateAccess(db, actor, {
      staffId: administrator!.id,
      role: "ADMINISTRATOR",
      schools: ["sma"],
    });
    expect(updated.schools).toEqual(["sma"]);
  });

  it("allows deactivation once a second administrator exists", async () => {
    const [first] = await listStaffProfiles(db, actor);
    await createStaff(db, actor, {
      name: "Administrator kedua",
      emails: ["admin2@mbss.sch.id"],
      role: "ADMINISTRATOR",
      schools: ["sma"],
    });

    const updated = await setStaffActive(db, actor, { staffId: first!.id, isActive: false });
    expect(updated.isActive).toBe(false);
  });

  // A move to smp holds the staff write lock while a save scoped to sma starts.
  // The save has to wait for the move and then be refused; without the lock it
  // checks scope against the old schools and lands.
  it("checks scope against the profile as it is when the save lands", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["sma"],
    });
    const [smp] = await findSchoolIdsByKeys(db, ["smp"]);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let moved!: () => void;
    const movedInsideLock = new Promise<void>((resolve) => (moved = resolve));
    const move = db.transaction(async (tx) => {
      await lockStaffWrites(tx);
      await replaceSchoolAccess(tx, created.id, [smp!.id]);
      moved();
      await released;
    });
    await movedInsideLock;

    const save = updateAccess(
      db,
      { ...actor, schoolKeys: ["sma"] },
      {
        staffId: created.id,
        role: "PRINCIPAL",
        schools: ["sma"],
      },
    );
    const outcome = save.then(
      () => "saved",
      (error: unknown) => error,
    );
    try {
      await waitForLockWait();
    } finally {
      release();
      await move;
    }

    expect(await outcome).toBeInstanceOf(ForbiddenError);
    const [after] = await listStaff(db, created.id);
    expect(after?.role).toBe("STAFF");
    expect(after?.schools).toEqual(["smp"]);
  });

  it("replaces school access rather than adding to it", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk", "sma"],
    });

    const updated = await updateAccess(db, actor, {
      staffId: created.id,
      role: "PRINCIPAL",
      schools: ["smp"],
    });

    expect(updated.schools).toEqual(["smp"]);
    expect(updated.role).toBe("PRINCIPAL");
  });

  it("records every change in the audit log", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });
    await setStaffActive(db, actor, { staffId: created.id, isActive: false });

    const entries = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, created.id))
      .orderBy(asc(schema.auditLogs.createdAt));

    expect(entries.map((entry) => entry.action)).toEqual(["staff.create", "staff.deactivate"]);
  });

  it("keeps addresses and names out of the audit rows", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });
    await updateStaffProfile(db, actor, {
      staffId: created.id,
      name: "Panitia Baru",
      emails: ["panitia@mbss.sch.id", "panitia@gmail.com"],
      role: "STAFF",
      schools: ["smk"],
    });
    await updateStaffProfile(db, actor, {
      staffId: created.id,
      name: "Panitia Baru",
      emails: ["panitia@gmail.com", "panitia2@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });

    const rows = await staffAuditRows();
    const text = JSON.stringify(rows.map((row) => row.metadata));
    expect(text).not.toMatch(/@|Panitia/);
    const [, , renamed, swapped] = rows.map((row) => row.metadata);
    expect(renamed).toMatchObject({ name: "changed", loginEmails: { removed: [] } });
    expect(swapped).toEqual({
      loginEmails: { added: [expect.any(String)], removed: [expect.any(String)] },
    });
  });

  it("writes no audit row for a save that changes nothing", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });
    await updateAccess(db, actor, { staffId: created.id, role: "STAFF", schools: ["smk"] });

    expect((await staffAuditRows()).map((row) => row.action)).toEqual([
      "staff.bootstrap",
      "staff.create",
    ]);
  });

  it("keeps one school address on every profile", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });

    await expect(
      updateStaffProfile(db, actor, {
        staffId: created.id,
        name: "Panitia",
        emails: ["panitia@gmail.com"],
        role: "STAFF",
        schools: ["smk"],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("names the address another profile holds", async () => {
    await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });

    await expect(
      createStaff(db, actor, {
        name: "Panitia dua",
        emails: ["dua@mbss.sch.id", "panitia@mbss.sch.id"],
        role: "STAFF",
        schools: ["smk"],
      }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN", data: { email: "panitia@mbss.sch.id" } });
  });

  it("ends a deactivated member's committee sessions and nothing else", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });
    const user = await signIn("panitia@mbss.sch.id");
    // A session the parent app made for the same person: no staff sign-in row.
    await db.insert(schema.session).values({
      id: "family-session",
      token: "family-token",
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    });
    expect(await sessionsOf(user.id)).toHaveLength(2);

    await setStaffActive(db, actor, { staffId: created.id, isActive: false });

    expect((await sessionsOf(user.id)).map((row) => row.id)).toEqual(["family-session"]);
    await expect(resolveStaff(db, user)).rejects.toThrow(/no access/);
  });

  it("signs out an address that is taken off a profile", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id", "panitia@gmail.com"],
      role: "STAFF",
      schools: ["smk"],
    });
    const user = await signIn("panitia@gmail.com");

    await updateStaffProfile(db, actor, {
      staffId: created.id,
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });

    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("shows the last sign-in and hides a profile nobody can sign in as", async () => {
    await insertStaff(db, { name: "Panitia simulasi", role: "ADMINISTRATOR" });
    const created = await createStaff(db, actor, {
      name: "Panitia",
      emails: ["panitia@mbss.sch.id"],
      role: "STAFF",
      schools: ["smk"],
    });
    await signIn("panitia@mbss.sch.id");

    const listed = await listStaffProfiles(db, actor);
    expect(listed.map((row) => row.name)).not.toContain("Panitia simulasi");
    expect(listed.find((row) => row.id === created.id)?.lastSignInAt).toEqual(expect.any(String));
  });
});
