import type { StaffRole } from "@mbs/api-contract";
import { schema } from "@mbs/db";
import { makeSignature } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";

// Real sessions through real HTTP: every guard between the cookie and the
// procedure runs, so deleting one of them fails a test here.
const config = loadConfig({
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
  BETTER_AUTH_URL: "http://localhost:3001",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  ADMIN_APP_URL: "http://localhost:5174",
});

const app = await buildApp(config);
const db = app.db;

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

beforeEach(async () => {
  await db.execute(
    sql`truncate ${schema.auditLogs}, ${schema.staffSchoolAccess}, ${schema.staffLoginEmails}, ${schema.staffUsers}, ${schema.user} cascade`,
  );
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
});

/**
 * Pre-approves a staff profile with every school, creates its Better Auth
 * user the way a Google sign-in does, and returns a signed session cookie.
 */
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

  const auth = await app.auth.$context;
  const { user } = await auth.internalAdapter.createOAuthUser(
    { email, name: role, emailVerified: true },
    { providerId: "google", accountId: `google-${role}` },
  );
  const { token } = await auth.internalAdapter.createSession(user.id);
  return `${auth.authCookies.sessionToken.name}=${token}.${await makeSignature(token, auth.secret)}`;
}

function call(path: string, json: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `/api/rpc/${path}`,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
    const response = await call("admin/staff/list", {}, await signIn("STAFF"));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ json: { code: "FORBIDDEN" } });
  });

  it("lets an ADMINISTRATOR session call an admin procedure", async () => {
    const response = await call("admin/staff/list", {}, await signIn("ADMINISTRATOR"));
    expect(response.statusCode).toBe(200);
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
    const auth = await app.auth.$context;
    await expect(
      auth.internalAdapter.createOAuthUser(
        { email: "orang.luar@gmail.com", name: "Orang luar", emailVerified: true },
        { providerId: "google", accountId: "google-luar" },
      ),
    ).rejects.toThrow(/no access/);
    expect(await db.select().from(schema.user)).toEqual([]);
  });
});
