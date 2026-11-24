import { schema } from "@mbs/db";
import { makeSignature } from "better-auth/crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.ts";
import { sessionCookie } from "./modules/auth/auth.ts";
import { createRateLimitStorage } from "./modules/auth/rate-limit.ts";
import { createFakeMailer } from "./modules/notification/email.ts";
import { FAMILY_HOST, STAFF_HOST, testConfig } from "./test/config.ts";
import { resetTables } from "./test/reset.ts";

const config = testConfig();
const mailer = createFakeMailer();
const app = await buildApp(config, { mailer });
const db = app.db;

beforeAll(() => app.ready());
afterAll(() => app.close());
// Codes are sent after the response. A send still running would deadlock the reset.
afterEach(() =>
  vi.waitFor(async () => {
    const unsent = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(inArray(schema.notifications.status, ["PENDING", "SENDING"]));
    expect(unsent).toEqual([]);
  }, 5_000),
);

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

function auth(host: string, path: string, body?: unknown, cookie?: string, ip = "203.0.113.7") {
  return app.inject({
    method: body === undefined ? "GET" : "POST",
    url: `/api/auth${path}`,
    headers: {
      host,
      origin: ORIGIN[host] ?? `http://${host}`,
      "x-forwarded-for": ip,
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

describe("code emails per address", () => {
  const ask = (email: string, ip?: string) =>
    auth(
      FAMILY_HOST,
      "/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      undefined,
      ip,
    );

  it("stops at five in 15 minutes, in any case, and the fifth code still works", async () => {
    let last = "";
    for (const email of ["Wali@example.com", "wali@example.com", "WALI@EXAMPLE.COM"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      last = (await requestCode(email)).code;
    }
    last = (await requestCode("wali@example.com")).code;
    last = (await requestCode("wali@example.com")).code;

    const refused = await ask("wAli@example.com");
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "TOO_MANY_CODES", lastCodeWorks: true });
    const wait = Number(refused.headers["x-retry-after"]);
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(mailer.sent).toHaveLength(5);

    expect((await ask("lain@example.com")).statusCode).toBe(200);
    expect((await signInWithCode("wali@example.com", last)).statusCode).toBe(200);
  });

  it("answers the same whether or not the address has an account", async () => {
    const { code } = await requestCode("punya@example.com");
    await signInWithCode("punya@example.com", code);

    const answers = [];
    for (const email of ["punya@example.com", "belum@example.com"]) {
      const sent = email === "punya@example.com" ? 1 : 0;
      for (let i = sent; i < 5; i++) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect((await ask(email, `203.0.113.${i + 20}`)).statusCode).toBe(200);
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      const refused = await ask(email, "203.0.113.30");
      answers.push([refused.statusCode, refused.json()]);
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]?.[0]).toBe(429);
  });

  it("sends again once the 15 minutes have passed", async () => {
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await requestCode("sabar@example.com");
    }
    await db.update(schema.notifications).set({ createdAt: sql`now() - interval '6 minutes'` });
    await db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 60_000) });
    const refused = await ask("sabar@example.com");
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ lastCodeWorks: false });
    expect(Number(refused.headers["x-retry-after"])).toBeLessThanOrEqual(9 * 60);
    await db.update(schema.notifications).set({ createdAt: sql`now() - interval '16 minutes'` });
    expect((await ask("sabar@example.com")).statusCode).toBe(200);
  });

  it("counts an address that is valid only once lowercased", async () => {
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await requestCode("kakek@example.com");
    }
    const refused = await ask("\u212Aakek@example.com");
    expect(refused.statusCode).toBe(429);
    expect(mailer.sent).toHaveLength(5);
  });

  it.each([
    [
      "three wrong tries",
      async () => {
        for (let i = 0; i < 3; i++) {
          // oxlint-disable-next-line eslint/no-await-in-loop
          await signInWithCode("salah@example.com", "000000");
        }
      },
    ],
    [
      "a send that failed for good",
      () => db.update(schema.notifications).set({ status: "FAILED" }),
    ],
  ])("says the last code is no use after %s", async (_, spoil) => {
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await requestCode("salah@example.com");
    }
    await spoil();
    const refused = await ask("salah@example.com");
    expect(refused.json()).toMatchObject({ code: "TOO_MANY_CODES", lastCodeWorks: false });
  });

  it("answers a request the limit refuses without waiting in the address's line", async () => {
    const busy = "198.51.100.9";
    for (let i = 0; i < 10; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await ask(`lain-${i}@example.com`, busy);
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`lock table notifications in access exclusive mode`);
      // `then` starts it: an injected request waits to be awaited.
      const waiting = ask("wali@example.com", "198.51.100.10").then((answer) => answer.statusCode);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const refused = await ask("wali@example.com", busy);
      expect(refused.statusCode).toBe(429);
      await tx.execute(sql`commit`);
      // Waiting in line would end only at the 8 s statement timeout, which refuses this one.
      expect(await waiting).toBe(200);
    });
  }, 20_000);

  it("holds when many requests arrive at once from many addresses", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => ask("banjir@example.com", `198.51.100.${i + 1}`)),
    );
    expect(await db.select().from(schema.notifications)).toHaveLength(5);
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(5));

    const code = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
    expect((await signInWithCode("banjir@example.com", code!)).statusCode).toBe(200);
  });

  it("refuses text that is no address before it reaches the database", async () => {
    const refused = await ask("a\u0000@example.com");
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "INVALID_EMAIL" });
  });

  it.each([[{ toString: 1, valueOf: 1 }], [["wali@example.com"]], [7]])(
    "refuses %j, which is not text",
    async (email) => {
      const refused = await auth(FAMILY_HOST, "/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      });
      expect(refused.statusCode).toBe(400);
    },
  );
});

describe("request limits", () => {
  const google = (host: string) =>
    auth(host, "/sign-in/social", { provider: "google", callbackURL: "/" });

  it("counts each app on its own, on a path both have", async () => {
    for (const _ of [1, 2, 3]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await google(STAFF_HOST)).statusCode).toBe(200);
    }
    const refused = await google(STAFF_HOST);
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers["x-retry-after"])).toBeGreaterThan(0);
    expect((await google(FAMILY_HOST)).statusCode).toBe(200);
  });

  it("lets exactly the limit through when requests arrive at once", async () => {
    const answers = await Promise.all(Array.from({ length: 8 }, () => google(FAMILY_HOST)));
    expect(answers.filter((answer) => answer.statusCode === 200)).toHaveLength(3);
  });

  it("opens again when the window ends, even for an address that never paused", async () => {
    let at = 1_000_000_000_000;
    const storage = createRateLimitStorage(db, "TEST", () => at);
    const rule = { window: 10, max: 3 };
    const allowed = [];
    for (let second = 0; second < 20; second += 4) {
      at = 1_000_000_000_000 + second * 1000;
      // oxlint-disable-next-line eslint/no-await-in-loop
      allowed.push((await storage.consume("ip|/path", rule)).allowed);
    }
    expect(allowed).toEqual([true, true, true, true, true]);

    await storage.consume("ip|/path", rule);
    expect(await storage.consume("ip|/path", rule)).toEqual({ allowed: false, retryAfter: 6 });
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
