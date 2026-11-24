import type { StaffRole } from "@mbs/api-contract";
import { schema } from "@mbs/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import { submitApplication } from "./modules/application/service.ts";
import { sessionCookie } from "./modules/auth/auth.ts";
import { FAMILY_HOST, STAFF_HOST, testConfig } from "./test/config.ts";
import { resetTables } from "./test/reset.ts";

const app = await buildApp(testConfig());
const db = app.db;

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

beforeEach(async () => {
  await resetTables(db, [
    schema.auditLogs,
    schema.staffSchoolAccess,
    schema.staffLoginEmails,
    schema.staffUsers,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
});

async function signIn(role: StaffRole) {
  const email = `${role.toLowerCase()}@mbss.sch.id`;
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({ name: role, role })
    .returning({ id: schema.staffUsers.id });
  await db
    .insert(schema.staffLoginEmails)
    .values({ staffId: staff!.id, email, kind: "INSTITUTIONAL" });
  const schools = await db.select({ id: schema.schools.id }).from(schema.schools);
  await db
    .insert(schema.staffSchoolAccess)
    .values(schools.map((school) => ({ staffId: staff!.id, schoolId: school.id })));

  const auth = await app.auth.STAFF.$context;
  const { user } = await auth.internalAdapter.createOAuthUser(
    { email, name: role, emailVerified: true },
    { providerId: "google", accountId: `google-${role}` },
  );
  return sessionCookie(app.auth.STAFF, user.id);
}

function call(path: string, json: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `/api/rpc/${path}`,
    headers: {
      host: STAFF_HOST,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    payload: { json },
  });
}

describe("procedure guards", () => {
  it("answers UNAUTHORIZED without a session", async () => {
    const response = await call("staff/me/get", {});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ json: { code: "UNAUTHORIZED" } });
  });

  it("lets a STAFF session read its own profile", async () => {
    const response = await call("staff/me/get", {}, await signIn("STAFF"));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ json: { role: "STAFF" } });
  });

  it("answers FORBIDDEN when a STAFF session calls an admin procedure", async () => {
    const cookie = await signIn("STAFF");
    expect((await call("staff/me/get", {}, cookie)).statusCode).toBe(200);

    const response = await call("admin/staff/list", {}, cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ json: { code: "FORBIDDEN" } });
  });

  it("lets an ADMINISTRATOR session call an admin procedure", async () => {
    const response = await call("admin/staff/list", {}, await signIn("ADMINISTRATOR"));
    expect(response.statusCode).toBe(200);
  });

  it("answers CONFLICT, not a 500, when the database refuses a duplicate", async () => {
    const cookie = await signIn("ADMINISTRATOR");
    const staff = {
      name: "Panitia",
      email: "panitia@mbss.sch.id",
      role: "STAFF",
      schools: ["sma"],
    };
    expect((await call("admin/staff/create", staff, cookie)).statusCode).toBe(200);

    const response = await call("admin/staff/create", staff, cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ json: { code: "CONFLICT" } });
  });

  it("answers CONFLICT, not a 500, when the domain refuses", async () => {
    const response = await call(
      "admin/staff/create",
      { name: "Orang luar", email: "luar@gmail.com", role: "STAFF", schools: ["sma"] },
      await signIn("ADMINISTRATOR"),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ json: { code: "CONFLICT" } });
  });
});

describe("sign-in gate", () => {
  it("refuses to create an identity for an address nobody approved", async () => {
    const auth = await app.auth.STAFF.$context;
    await expect(
      auth.internalAdapter.createOAuthUser(
        { email: "orang.luar@gmail.com", name: "Orang luar", emailVerified: true },
        { providerId: "google", accountId: "google-luar" },
      ),
    ).rejects.toThrow(/no access/);
    expect(await db.select().from(schema.user)).toEqual([]);
  });
});

describe("family procedures", () => {
  const DAY = 86_400_000;

  async function family(id: string) {
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      updatedAt: new Date(),
    });
    return sessionCookie(app.auth.FAMILY, id);
  }

  async function applicationOf(userId: string) {
    await resetTables(db, [schema.admissionCycles]);
    const [cycle] = await db
      .insert(schema.admissionCycles)
      .values({
        name: "2027/2028",
        registrationOpenAt: new Date(Date.now() - DAY),
        registrationCloseAt: new Date(Date.now() + 30 * DAY),
        resultPublishAt: new Date(Date.now() + 60 * DAY),
        defaultFee: 250_000,
        status: "OPEN",
      })
      .returning();
    const { application } = await submitApplication(
      db,
      {
        cycleId: cycle!.id,
        schoolKey: "smp",
        userId,
        profile: {
          childFullName: "Aisyah Putri",
          nik: "6472010101010001",
          birthDate: "2014-05-01",
          sex: "FEMALE",
          schoolOfOrigin: "SD Negeri 1 Samarinda",
          guardianName: "Budi",
          guardianRelation: "FATHER",
          guardianPhone: "081234567890",
        },
        idempotencyKey: null,
      },
      { familyAppUrl: "http://localhost:5173" },
    );
    return application;
  }

  function onFamilyHost(path: string, json: unknown, cookie?: string) {
    return app.inject({
      method: "POST",
      url: `/api/rpc/${path}`,
      headers: {
        host: FAMILY_HOST,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      payload: { json },
    });
  }

  it("shows a family its own application", async () => {
    const cookie = await family("family-a");
    const application = await applicationOf("family-a");
    const response = await onFamilyHost(
      "applicant/applications/get",
      { applicationId: application.id },
      cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      json: { registrationNumber: "SMP-0001", stage: "PAYMENT_DUE" },
    });
  });

  it("answers another family's application exactly as an unknown id", async () => {
    await family("family-a");
    const application = await applicationOf("family-a");
    const other = await family("family-b");

    const theirs = await onFamilyHost(
      "applicant/applications/get",
      { applicationId: application.id },
      other,
    );
    const unknown = await onFamilyHost(
      "applicant/applications/get",
      { applicationId: crypto.randomUUID() },
      other,
    );
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(unknown.json());
  });

  it("refuses a family session on a staff procedure, even for approved staff", async () => {
    const staffCookie = await signIn("STAFF");
    const [user] = await db.select().from(schema.user);
    const familyCookie = await sessionCookie(app.auth.FAMILY, user!.id);

    expect((await onFamilyHost("staff/me/get", {}, familyCookie)).statusCode).toBe(401);
    expect((await call("staff/me/get", {}, staffCookie)).statusCode).toBe(200);
  });

  it("refuses a staff session on a family procedure", async () => {
    const staffCookie = await signIn("STAFF");
    const response = await call(
      "applicant/applications/get",
      { applicationId: crypto.randomUUID() },
      staffCookie,
    );
    expect(response.statusCode).toBe(401);
  });
});
