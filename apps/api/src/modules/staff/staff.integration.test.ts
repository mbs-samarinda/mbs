import { createDatabase, schema } from "@mbs/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "../../errors.ts";
import { resolveStaff, type StaffContext } from "../auth/authorization.ts";
import { ensureBootstrapAdministrator } from "./bootstrap.ts";
import { isApprovedLoginEmail } from "./repository.ts";
import { createStaff, listStaffProfiles, setStaffActive, updateStaffAccess } from "./service.ts";

const db = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

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
  await db.execute(
    sql`truncate ${schema.auditLogs}, ${schema.staffSchoolAccess}, ${schema.staffLoginEmails}, ${schema.staffUsers}, ${schema.user} cascade`,
  );
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
});

afterAll(() => db.$client.end());

describe("ensureBootstrapAdministrator", () => {
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
      email: "admin2@mbss.sch.id",
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
      email: "admin2@mbss.sch.id",
      role: "ADMINISTRATOR",
      schools: ["sma", "smk", "smp"],
    });
    await updateStaffAccess(db, actor, {
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

  it("matches a pre-approved address whatever case the provider sends", async () => {
    await ensureBootstrapAdministrator(db, BOOTSTRAP_EMAIL);
    const user = await seedAuthUser("auth-kepala", "Kepala@MBSS.sch.id");

    expect((await resolveStaff(db, user)).role).toBe("ADMINISTRATOR");
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
      email: "panitia.smk@mbss.sch.id",
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
        email: "panitia.sma@mbss.sch.id",
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
      email: "panitia.sma@mbss.sch.id",
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
      email: "panitia.sma@mbss.sch.id",
      role: "STAFF",
      schools: ["sma"],
    });
    const scoped = { ...actor, schoolKeys: ["smk"] as const };

    await expect(
      updateStaffAccess(db, scoped, { staffId: target.id, role: "STAFF", schools: ["smk"] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("hides profiles outside the acting administrator's scope from the list", async () => {
    await createStaff(db, actor, {
      name: "Panitia SMA",
      email: "panitia.sma@mbss.sch.id",
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
      email: "panitia@mbss.sch.id",
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
        email: "panitia@gmail.com",
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
      updateStaffAccess(db, actor, {
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
      updateStaffAccess(db, actor, {
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
      email: "admin2@mbss.sch.id",
      role: "ADMINISTRATOR",
      schools: ["sma", "smk", "smp"],
    });

    const updated = await updateStaffAccess(db, actor, {
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
      email: "admin2@mbss.sch.id",
      role: "ADMINISTRATOR",
      schools: ["sma"],
    });

    const updated = await setStaffActive(db, actor, { staffId: first!.id, isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("replaces school access rather than adding to it", async () => {
    const created = await createStaff(db, actor, {
      name: "Panitia",
      email: "panitia@mbss.sch.id",
      role: "STAFF",
      schools: ["smk", "sma"],
    });

    const updated = await updateStaffAccess(db, actor, {
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
      email: "panitia@mbss.sch.id",
      role: "STAFF",
      schools: ["smk"],
    });
    await setStaffActive(db, actor, { staffId: created.id, isActive: false });

    const entries = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, created.id));

    expect(entries.map((entry) => entry.action)).toEqual(["staff.create", "staff.deactivate"]);
  });
});
