import { schema } from "@mbs/db";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.ts";
import { sessionCookie } from "./modules/auth/auth.ts";
import { createFakeMailer } from "./modules/notification/email.ts";
import { FAMILY_HOST, STAFF_HOST, testConfig } from "./test/config.ts";
import { resetTables } from "./test/reset.ts";

const config = testConfig();
const mailer = createFakeMailer();
const app = await buildApp(config, { mailer });
const db = app.db;

beforeAll(() => app.ready());
afterAll(() => app.close());

beforeEach(async () => {
  mailer.sent.length = 0;
  await resetTables(db, [
    schema.auditLogs,
    schema.notificationAttempts,
    schema.notifications,
    schema.rateLimit,
    schema.verification,
    schema.session,
    schema.account,
    schema.staffSchoolAccess,
    schema.staffLoginEmails,
    schema.staffUsers,
    schema.user,
  ]);
});

const ORIGIN: Record<string, string> = {
  [FAMILY_HOST]: config.auth.familyAppUrl,
  [STAFF_HOST]: config.auth.adminAppUrl,
};

function auth(host: string, path: string, body?: unknown, cookie?: string) {
  return app.inject({
    method: body === undefined ? "GET" : "POST",
    url: `/api/auth${path}`,
    headers: {
      host,
      origin: ORIGIN[host] ?? `http://${host}`,
      "x-forwarded-for": "203.0.113.7",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

function rpc(host: string, path: string, json: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `/api/rpc/${path}`,
    headers: { host, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    payload: { json },
  });
}

const Session = z.object({ user: z.object({ id: z.string() }) });

async function sessionOn(host: string, cookie: string) {
  const response = await auth(host, "/get-session", undefined, cookie);
  return response.statusCode === 200 ? Session.nullable().parse(response.json()) : null;
}

async function requestCode(email: string) {
  const sentBefore = mailer.sent.length;
  const response = await auth(FAMILY_HOST, "/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  expect(response.statusCode).toBe(200);
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(sentBefore + 1));
  const message = mailer.sent.at(-1);
  const code = /\b(\d{6})\b/.exec(message?.text ?? "")?.[1];
  if (!code) throw new Error("no code in the email");
  return { code, message: message! };
}

function signInWithCode(email: string, otp: string) {
  return auth(FAMILY_HOST, "/sign-in/email-otp", { email, otp });
}

function cookieFrom(response: { headers: Record<string, unknown> }, name: string) {
  const header = response.headers["set-cookie"];
  const lines = Array.isArray(header) ? header : [header];
  const line = lines.find((value) => typeof value === "string" && value.startsWith(`${name}=`));
  return typeof line === "string" ? { pair: line.split(";")[0]!, line } : null;
}

async function approvedStaff(email: string) {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({ name: email, role: "ADMINISTRATOR" })
    .returning({ id: schema.staffUsers.id });
  await db
    .insert(schema.staffLoginEmails)
    .values({ staffId: staff!.id, email, kind: "INSTITUTIONAL" });
  const context = await app.auth.STAFF.$context;
  const { user } = await context.internalAdapter.createOAuthUser(
    { email, name: email, emailVerified: true },
    { providerId: "google", accountId: `google-${email}` },
  );
  return user;
}

describe("one auth instance per app host", () => {
  it("signs a family in on the family host only, with a host-only cookie of its own name", async () => {
    const { code } = await requestCode("ibu@example.com");
    const signedIn = await signInWithCode("ibu@example.com", code);
    expect(signedIn.statusCode).toBe(200);

    const cookie = cookieFrom(signedIn, "mbs_family.session_token");
    expect(cookie).not.toBeNull();
    expect(cookie!.line).not.toMatch(/domain=/i);
    expect(cookie!.line).toMatch(/httponly/i);

    expect((await sessionOn(FAMILY_HOST, cookie!.pair))?.user.id).toBeDefined();
    expect(await sessionOn(STAFF_HOST, cookie!.pair)).toBeNull();
    expect((await rpc(STAFF_HOST, "staff/me/get", {}, cookie!.pair)).statusCode).toBe(401);
  });

  it("resolves a staff session on the staff host only", async () => {
    const user = await approvedStaff("kepala@mbss.sch.id");
    const cookie = await sessionCookie(app.auth.STAFF, user.id);

    expect((await rpc(STAFF_HOST, "staff/me/get", {}, cookie)).statusCode).toBe(200);
    expect(await sessionOn(FAMILY_HOST, cookie)).toBeNull();
    expect((await rpc(FAMILY_HOST, "staff/me/get", {}, cookie)).statusCode).toBe(401);
  });

  it("refuses a family token renamed to the staff cookie", async () => {
    const user = await approvedStaff("guru@mbss.sch.id");
    const family = await sessionCookie(app.auth.FAMILY, user.id);
    const signed = decodeURIComponent(family.split("=")[1]!);
    const renamed = `mbs_staff.session_token=${encodeURIComponent(signed)}`;

    expect((await rpc(STAFF_HOST, "staff/me/get", {}, renamed)).statusCode).toBe(401);
  });

  it("refuses a staff token signed with the family key", async () => {
    const user = await approvedStaff("tu@mbss.sch.id");
    const staff = await sessionCookie(app.auth.STAFF, user.id);
    const token = decodeURIComponent(staff.split("=")[1]!).split(".")[0]!;
    const familyKey = (await app.auth.FAMILY.$context).secret;
    const forged = `mbs_staff.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, familyKey)}`)}`;

    expect((await rpc(STAFF_HOST, "staff/me/get", {}, forged)).statusCode).toBe(401);
  });

  it("gives any other host no auth routes and no session", async () => {
    const user = await approvedStaff("admin@mbss.sch.id");
    const cookie = await sessionCookie(app.auth.STAFF, user.id);

    expect((await auth("api:3001", "/get-session", undefined, cookie)).statusCode).toBe(404);
    expect((await rpc("api:3001", "staff/me/get", {}, cookie)).statusCode).toBe(401);
    expect(
      (await rpc("api:3001", "public/admission/getCurrentCycle", { schoolKey: "sma" })).statusCode,
    ).toBe(200);
  });

  it("refuses a staff session to a family account that is not approved staff", async () => {
    const { code } = await requestCode("ibu@example.com");
    await signInWithCode("ibu@example.com", code);
    const [user] = await db.select().from(schema.user);
    const before = await db.select().from(schema.session);

    const staff = await app.auth.STAFF.$context;
    await expect(staff.internalAdapter.createSession(user!.id)).rejects.toMatchObject({
      body: { code: "account_not_approved" },
    });
    expect(await db.select().from(schema.session)).toEqual(before);
  });

  it("offers email codes on the family host only", async () => {
    const response = await auth(STAFF_HOST, "/email-otp/send-verification-otp", {
      email: "kepala@mbss.sch.id",
      type: "sign-in",
    });
    expect(response.statusCode).toBe(404);
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });
});

describe("email codes", () => {
  it("creates one account on first sign-in and sends the code by email", async () => {
    const { code, message } = await requestCode("ayah@example.com");
    expect(message.to).toBe("ayah@example.com");
    expect(message.subject).toContain(code);

    const signedIn = await signInWithCode("ayah@example.com", code);
    expect(signedIn.statusCode).toBe(200);
    const users = await db.select().from(schema.user);
    expect(users.map((user) => user.email)).toEqual(["ayah@example.com"]);

    const [row] = await db.select().from(schema.notifications);
    expect(row).toMatchObject({
      status: "SENT",
      templateKey: "sign-in-code",
      subject: null,
      bodyText: null,
      bodyHtml: null,
    });
    const stored = await db.select({ value: schema.verification.value }).from(schema.verification);
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it("refuses every code flow but sign-in, the same for known and unknown addresses", async () => {
    const { code } = await requestCode("ibu@example.com");
    await signInWithCode("ibu@example.com", code);
    const before = await db.select().from(schema.notifications);

    for (const email of ["ibu@example.com", "orang.baru@example.com"]) {
      for (const [path, body] of [
        ["/email-otp/send-verification-otp", { email, type: "forget-password" }],
        ["/email-otp/send-verification-otp", { email, type: "email-verification" }],
        ["/email-otp/request-password-reset", { email }],
        ["/forget-password/email-otp", { email }],
      ] as const) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await auth(FAMILY_HOST, path, body);
        expect(response.statusCode, path).toBe(400);
        expect(response.json()).toMatchObject({ code: "SIGN_IN_ONLY" });
      }
    }
    expect(await db.select().from(schema.notifications)).toEqual(before);
  });

  it("reaches the same user from an address in any case", async () => {
    const first = await requestCode("Siti.Aminah@Example.com");
    expect(first.message.to).toBe("siti.aminah@example.com");
    const a = await signInWithCode("siti.aminah@example.com", first.code);
    const second = await requestCode("SITI.AMINAH@EXAMPLE.COM");
    const b = await signInWithCode("SITI.AMINAH@EXAMPLE.COM", second.code);

    expect(Session.parse(a.json()).user.id).toBe(Session.parse(b.json()).user.id);
    expect(await db.select().from(schema.user)).toHaveLength(1);
  });

  it("stops accepting a code after three wrong tries, even the right one", async () => {
    const { code } = await requestCode("wali@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (const _ of [1, 2, 3]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await signInWithCode("wali@example.com", wrong)).statusCode).toBe(400);
    }
    const refused = await signInWithCode("wali@example.com", code);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});

describe("sign-in audit", () => {
  it("records sign-in, a failed code and sign-out with no email or code", async () => {
    const { code } = await requestCode("nenek@example.com");
    await signInWithCode("nenek@example.com", code === "999999" ? "888888" : "999999");
    const signedIn = await signInWithCode("nenek@example.com", code);
    const cookie = cookieFrom(signedIn, "mbs_family.session_token")!.pair;
    expect((await auth(FAMILY_HOST, "/sign-out", {}, cookie)).statusCode).toBe(200);

    const staff = await approvedStaff("bendahara@mbss.sch.id");
    const staffCookie = await sessionCookie(app.auth.STAFF, staff.id);
    expect((await auth(STAFF_HOST, "/sign-out", {}, staffCookie)).statusCode).toBe(200);

    const rows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityType, "user"))
      .orderBy(schema.auditLogs.createdAt);
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "nenek@example.com"));
    const family = rows.filter((row) => row.actorType === "FAMILY");
    expect(family).toMatchObject([
      { action: "auth.sign_in_failed", metadata: { method: "EMAIL_CODE" } },
      { action: "auth.sign_in", metadata: { method: "EMAIL_CODE" } },
      { action: "auth.sign_out" },
    ]);
    expect(family.map((row) => row.actorId)).toEqual([null, user!.id, user!.id]);
    for (const row of family) {
      expect(row.requestId).toMatch(/.+/);
      expect(row.ipAddress).toBe("203.0.113.7");
      expect(row.userAgent).toBe("lightMyRequest");
    }
    expect(rows.filter((row) => row.actorType === "STAFF").map((row) => row.action)).toEqual([
      "auth.sign_in",
      "auth.sign_out",
    ]);

    const everything = JSON.stringify(rows);
    expect(everything).not.toContain("nenek@example.com");
    expect(everything).not.toContain("bendahara@mbss.sch.id");
    expect(everything).not.toContain(code);
  });
});
