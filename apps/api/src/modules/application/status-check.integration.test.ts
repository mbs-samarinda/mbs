import type { ApplicantProfileInput, AppliedCommand } from "@mbs/api-contract";
import { schema } from "@mbs/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../app.ts";
import { FAMILY_HOST, STAFF_HOST, testConfig } from "../../test/config.ts";
import { lockTable } from "../../test/lock.ts";
import { resetTables } from "../../test/reset.ts";
import { sessionCookie } from "../auth/auth.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { applyCommand, saveProfile, submitApplication, type Actor } from "./service.ts";

const logLines: string[] = [];
const app = await buildApp(testConfig({ LOG_LEVEL: "trace" }), {
  logStream: { write: (line) => void logLines.push(line) },
  mailer: { send: async () => ({ responseCode: "250" }), close() {} },
});
// A second process over the same database, as during a deploy.
const otherApp = await buildApp(testConfig());
const db = app.db;
const OUTBOX = { familyAppUrl: "http://localhost:5173" };
const DAY = 86_400_000;
const PATH = "/api/rpc/public/application/checkStatus";

beforeAll(() => Promise.all([app.ready(), otherApp.ready()]));
afterAll(() => Promise.all([app.close(), otherApp.close()]));

const staff: StaffContext = {
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "Panitia",
  role: "STAFF",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-staff",
};
const STAFF: Actor = { type: "STAFF", staff };
const FAMILY: Actor = { type: "FAMILY", userId: "family-a" };

const NIK = "6472014105140001";
const WRONG_NIK = "6472014105149999";

beforeEach(async () => {
  await resetTables(db, [
    schema.statusCheckTries,
    schema.rateLimit,
    schema.notificationAttempts,
    schema.notifications,
    schema.auditLogs,
    schema.applicationEvents,
    schema.applicantProfileVersions,
    schema.applicationDocumentRequirements,
    schema.applicationAccess,
    schema.applications,
    schema.documentRequirements,
    schema.schoolAdmissionSettings,
    schema.admissionCycles,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
  await db.insert(schema.user).values({
    id: "family-a",
    name: "family-a",
    email: "family-a@example.test",
    emailVerified: true,
    updatedAt: new Date(),
  });
  logLines.length = 0;
});

async function openCycle(name = "2027/2028", openedDaysAgo = 1) {
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name,
      registrationOpenAt: new Date(Date.now() - openedDaysAgo * DAY),
      registrationCloseAt: new Date(Date.now() + 30 * DAY),
      resultPublishAt: new Date(Date.now() + 60 * DAY),
      defaultFee: 250_000,
      status: "OPEN",
    })
    .returning();
  return cycle!.id;
}

function profile(changes: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput {
  return {
    childFullName: "Aisyah Putri",
    nik: NIK,
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi Santoso",
    guardianRelation: "FATHER",
    guardianPhone: "0812 3456 7890",
    ...changes,
  };
}

async function register(cycleId: string, changes?: Partial<ApplicantProfileInput>) {
  const { application } = await submitApplication(
    db,
    {
      cycleId,
      schoolKey: "smp",
      userId: "family-a",
      profile: profile(changes),
      idempotencyKey: null,
    },
    OUTBOX,
  );
  return application.id;
}

async function walk(
  applicationId: string,
  steps: [Actor, AppliedCommand, Record<string, unknown>?][],
  from = 1,
) {
  for (const [index, [actor, command, payload]] of steps.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await applyCommand(
      db,
      {
        applicationId,
        actor,
        command,
        payload: { payloadVersion: 1, ...payload },
        expectedSeq: from + index,
        idempotencyKey: null,
      },
      OUTBOX,
    );
  }
}

const TO_INTERVIEWED: [Actor, AppliedCommand, Record<string, unknown>?][] = [
  [FAMILY, "UPLOAD_PAYMENT_PROOF"],
  [STAFF, "REJECT_PAYMENT", { reason: "ALASAN-PANITIA" }],
  [FAMILY, "UPLOAD_PAYMENT_PROOF"],
  [STAFF, "APPROVE_PAYMENT"],
  [STAFF, "ADD_NOTE", { note: "CATATAN-RAHASIA" }],
  [FAMILY, "SUBMIT_DOCUMENTS"],
  [STAFF, "VERIFY_DOCUMENTS"],
  [STAFF, "ADVANCE_TO_INTERVIEW"],
  [STAFF, "SCHEDULE_INTERVIEW"],
  [STAFF, "RECORD_ATTENDED"],
];

type Asked = {
  number?: string;
  nik?: string;
  address?: string;
  host?: string;
  cookie?: string;
  via?: typeof app;
};

function check({ number = "SMP-0001", nik = NIK, address = "203.0.113.7", ...rest }: Asked = {}) {
  return (rest.via ?? app).inject({
    method: "POST",
    url: PATH,
    headers: {
      host: rest.host ?? FAMILY_HOST,
      "content-type": "application/json",
      "x-forwarded-for": address,
      "user-agent": "grandma-phone",
      ...(rest.cookie ? { cookie: rest.cookie } : {}),
    },
    payload: { json: { registrationNumber: number, nik } },
  });
}

const currentCycle = () =>
  app.inject({
    method: "POST",
    url: "/api/rpc/public/admission/getCurrentCycle",
    headers: { host: FAMILY_HOST },
    payload: { json: { schoolKey: "smp" } },
  });

/** Wrong tries on one number, each from its own address so only the number is limited. */
async function wrongTries(count: number, number = "SMP-0001") {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await check({ number, nik: WRONG_NIK, address: `198.51.100.${index + 1}` });
    statuses.push(response.statusCode);
  }
  return statuses;
}

async function letPass(seconds: number) {
  await db.update(schema.statusCheckTries).set({
    createdAt: sql`${schema.statusCheckTries.createdAt} - make_interval(secs => ${seconds})`,
  });
}

const count = (statuses: number[], status: number) =>
  statuses.filter((one) => one === status).length;

const lookups = () =>
  db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.action, "application.status_checked"))
    .orderBy(schema.auditLogs.createdAt);

describe("the answer", () => {
  it("holds exactly what someone without an account may see", async () => {
    const id = await register(await openCycle());
    await walk(id, TO_INTERVIEWED);
    const response = await check();

    expect(response.statusCode).toBe(200);
    const answer = response.json().json;
    expect(Object.keys(answer).toSorted()).toEqual([
      "childName",
      "finished",
      "registrationNumber",
      "schoolKey",
      "stage",
    ]);
    const at = expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(answer).toEqual({
      childName: "Aisyah Putri",
      registrationNumber: "SMP-0001",
      schoolKey: "smp",
      stage: "INTERVIEWED",
      finished: { REGISTRATION: at, PAYMENT: at, DOCUMENTS: at, SCREENING: at, INTERVIEW: at },
    });
    expect(response.body).not.toMatch(
      /6472|0812|62812|example\.test|Budi|Negeri|250000|ALASAN|CATATAN|family-a|0000000000aa/,
    );
    expect(response.body).not.toContain(id);
  });

  it("says when each milestone was finished", async () => {
    const id = await register(await openCycle());
    await walk(id, TO_INTERVIEWED);
    const events = await db
      .select()
      .from(schema.applicationEvents)
      .where(eq(schema.applicationEvents.applicationId, id));
    const timeOf = (command: string) =>
      events.find((event) => event.command === command)!.createdAt.toISOString();

    expect((await check()).json().json.finished).toEqual({
      REGISTRATION: timeOf("SUBMIT"),
      PAYMENT: timeOf("APPROVE_PAYMENT"),
      DOCUMENTS: timeOf("VERIFY_DOCUMENTS"),
      SCREENING: timeOf("ADVANCE_TO_INTERVIEW"),
      INTERVIEW: timeOf("RECORD_ATTENDED"),
    });
  });

  it("does not change when the committee decides, and does when it is published", async () => {
    const id = await register(await openCycle());
    await walk(id, TO_INTERVIEWED);
    const before = await check();
    const after = TO_INTERVIEWED.length + 1;
    await walk(
      id,
      [
        [STAFF, "DECIDE", { decision: "NOT_ACCEPTED" }],
        [STAFF, "ADD_NOTE", { note: "Ditolak." }],
      ],
      after,
    );
    const decided = await check();
    expect(decided.statusCode).toBe(200);
    expect(decided.body).toBe(before.body);

    await walk(id, [[{ type: "SYSTEM", job: "publish" }, "PUBLISH_NOT_ACCEPTED"]], after + 2);
    expect((await check()).json().json).toMatchObject({
      stage: "NOT_ACCEPTED",
      finished: { ANNOUNCEMENT: expect.any(String) },
    });
  });

  it("says nothing of a milestone whose event the family may not see", async () => {
    const applicationId = await register(await openCycle());
    await db.insert(schema.applicationEvents).values({
      applicationId,
      seq: 2,
      command: "CONFIRM_ENROLLMENT",
      fromStage: "PAYMENT_DUE",
      toStage: "PAYMENT_DUE",
      actorType: "STAFF",
      actorId: staff.id,
      familyVisible: false,
      payload: { payloadVersion: 1 },
      payloadVersion: 1,
    });
    expect(Object.keys((await check()).json().json.finished)).toEqual(["REGISTRATION"]);
  });

  it.each(["smp-0001", "SMP0001", " Smp 1 ", "smp–001"])("finds %j", async (number) => {
    await register(await openCycle());
    expect((await check({ number })).json()).toMatchObject({
      json: { registrationNumber: "SMP-0001" },
    });
  });

  it("reads a NIK with spaces and dots, and shows the newest name", async () => {
    const applicationId = await register(await openCycle());
    await saveProfile(
      db,
      {
        applicationId,
        actor: FAMILY,
        profile: profile({ childFullName: "Aisyah Ramadhani" }),
        expectedSeq: 1,
        idempotencyKey: null,
      },
      OUTBOX,
    );
    const response = await check({ nik: "6472 0141.0514 0001" });
    expect(response.json().json.childName).toBe("Aisyah Ramadhani");
  });

  it("tells numbers that repeat across cycles apart by the NIK, newest cycle first", async () => {
    const lastYear = await openCycle("2026/2027", 400);
    await register(lastYear, { childFullName: "Aisyah Tahun Lalu" });
    await db.update(schema.admissionCycles).set({ status: "ARCHIVED" });
    const other = await openCycle("2027/2028", 30);
    await register(other, { childFullName: "Umar", nik: "6472010101010002" });
    await db.update(schema.admissionCycles).set({ status: "ARCHIVED" });

    expect((await check()).json().json.childName).toBe("Aisyah Tahun Lalu");
    expect((await check({ nik: "6472010101010002" })).json().json.childName).toBe("Umar");

    await register(await openCycle("2028/2029", 1), { childFullName: "Aisyah Tahun Ini" });
    expect((await check()).json().json.childName).toBe("Aisyah Tahun Ini");
  });

  it("is never kept by a browser or a proxy", async () => {
    await register(await openCycle());
    const hit = await check();
    const miss = await check({ nik: WRONG_NIK });
    await wrongTries(5);
    const refused = await check();
    expect([hit, miss, refused].map(({ statusCode }) => statusCode)).toEqual([200, 404, 429]);
    for (const { headers } of [hit, miss, refused]) {
      expect(headers["cache-control"]).toBe("no-store");
    }
  });

  it("gives the visitor no access to the application", async () => {
    await register(await openCycle());
    await db.delete(schema.applicationAccess);
    const cookie = await sessionCookie(app.auth.FAMILY, "family-a");
    expect((await check({ cookie })).statusCode).toBe(200);
    expect(await db.$count(schema.applicationAccess)).toBe(0);
  });
});

describe("a miss", () => {
  it.each([
    ["an unknown number", { number: "SMP-0999" }],
    ["another school's number", { number: "SMA-0001" }],
    ["a number that cannot exist", { number: "bukan nomor" }],
    ["a number with a byte Postgres refuses", { number: "SMP\u0000-0001" }],
    ["an empty number", { number: "" }],
    ["a very long number", { number: "9".repeat(100_000) }],
    ["a NIK that is too short", { nik: "6472" }],
    ["a NIK with a byte Postgres refuses", { nik: "\u0000" }],
    ["an empty NIK", { nik: "" }],
  ])("answers %s exactly like a wrong NIK", async (_, asked) => {
    await register(await openCycle());
    const wrongNik = await check({ nik: WRONG_NIK });
    const miss = await check(asked);

    expect(wrongNik.statusCode).toBe(404);
    expect(wrongNik.json()).toMatchObject({ json: { defined: true, code: "NO_MATCH" } });
    expect(miss.statusCode).toBe(404);
    expect(miss.body).toBe(wrongNik.body);
    const [first, second] = await lookups();
    const own = { id: second!.id, requestId: second!.requestId, createdAt: second!.createdAt };
    expect(second).toEqual({ ...first, ...own });
    // The address and the number, for each of the two.
    expect(await db.$count(schema.statusCheckTries)).toBe(4);
  });
});

describe("the limits", () => {
  it("refuses the sixth try on a number even with the right NIK, and says when to try again", async () => {
    await register(await openCycle());
    expect(await wrongTries(5)).toEqual([404, 404, 404, 404, 404]);
    await letPass(60);

    const refused = await check();
    expect(refused.statusCode).toBe(429);
    const { code, defined, data } = refused.json().json;
    expect({ code, defined }).toEqual({ code: "TOO_MANY_TRIES", defined: true });
    expect(data.retryAfterSeconds).toBeGreaterThan(13 * 60);
    expect(data.retryAfterSeconds).toBeLessThanOrEqual(14 * 60);

    await letPass(data.retryAfterSeconds);
    expect((await check()).statusCode).toBe(200);
  });

  it("refuses an unknown number as it does a real one", async () => {
    await register(await openCycle());
    await wrongTries(5);
    await wrongTries(5, "SMP-0999");
    const real = (await check()).json().json;
    const unknown = (await check({ number: "SMP-0999" })).json().json;
    expect(real.code).toBe("TOO_MANY_TRIES");
    expect(Math.abs(unknown.data.retryAfterSeconds - real.data.retryAfterSeconds)).toBeLessThan(5);
    expect({ ...unknown, data: null }).toEqual({ ...real, data: null });
  });

  it("counts a number once, however it is typed", async () => {
    await register(await openCycle());
    for (const number of ["SMP-0001", "smp1", "SMP 0001", "smp-001", "Smp–1"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await check({ number, nik: WRONG_NIK });
    }
    expect((await check()).statusCode).toBe(429);
  });

  it("allows 20 wrong tries on a number in a day, not 5 in every 15 minutes", async () => {
    await register(await openCycle());
    for (let round = 0; round < 4; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect(await wrongTries(5)).toEqual([404, 404, 404, 404, 404]);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await letPass(901);
    }
    const refused = await check();
    expect(refused.statusCode).toBe(429);
    expect(refused.json().json.data.retryAfterSeconds).toBeGreaterThan(22 * 3600);

    await letPass(86_400);
    expect((await check()).statusCode).toBe(200);
  });

  it("never allows more than 5 wrong tries in any 15 minutes", async () => {
    await register(await openCycle());
    await wrongTries(1);
    await letPass(890);
    expect(await wrongTries(4)).toEqual([404, 404, 404, 404]);
    await letPass(20);
    // The first try is out of the window now, the other four are not.
    expect(await wrongTries(2)).toEqual([404, 429]);
  });

  it("does not count a right answer against a number, and does not reset it either", async () => {
    await register(await openCycle());
    for (let index = 1; index <= 8; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await check({ address: `192.0.2.${index}` })).statusCode).toBe(200);
    }
    await wrongTries(4);
    expect((await check()).statusCode).toBe(200);
    expect(await wrongTries(2)).toEqual([404, 429]);

    await letPass(901);
    expect((await check()).statusCode).toBe(200);
    for (let round = 0; round < 3; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await wrongTries(5);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await letPass(901);
    }
    expect((await check()).statusCode).toBe(429);
  });

  it("holds against 20 tries at once, over two API processes", async () => {
    await register(await openCycle());
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        check({
          nik: WRONG_NIK,
          address: `198.51.100.${index + 1}`,
          via: index % 2 ? app : otherApp,
        }),
      ),
    );
    const statuses = responses.map(({ statusCode }) => statusCode);
    expect([count(statuses, 404), count(statuses, 429)]).toEqual([5, 15]);
  });

  it("lets at most five guesses at once through, even when one is right", async () => {
    await register(await openCycle());
    await wrongTries(4);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        check({
          nik: index === 9 ? NIK : WRONG_NIK,
          address: `192.0.2.${index + 1}`,
          via: index % 2 ? app : otherApp,
        }),
      ),
    );
    expect(
      count(
        responses.map(({ statusCode }) => statusCode),
        404,
      ),
    ).toBe(1);
  });

  it("leaves other numbers alone", async () => {
    const cycleId = await openCycle();
    await register(cycleId);
    await register(cycleId, { nik: "6472010101010002", childFullName: "Umar" });
    await wrongTries(6);
    expect((await check()).statusCode).toBe(429);
    expect((await check({ number: "SMP-0002", nik: "6472010101010002" })).statusCode).toBe(200);
  });

  it("keeps one visitor's unreadable numbers from locking out another's", async () => {
    for (let index = 0; index < 5; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await check({ number: `salah ${index}` })).statusCode).toBe(404);
    }
    expect((await check({ number: "lain lagi" })).statusCode).toBe(429);
    expect((await check({ number: "salah", address: "198.51.100.1" })).statusCode).toBe(404);
  });

  it("allows 20 wrong tries from one address in 15 minutes", async () => {
    await register(await openCycle());
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, index) => check({ number: `SMP-${100 + index}` })),
    );
    const statuses = responses.map(({ statusCode }) => statusCode);
    expect(count(statuses, 429)).toBe(10);
    expect(count(statuses, 404)).toBe(20);

    const refused = await check();
    expect(refused.json()).toMatchObject({ json: { code: "TOO_MANY_TRIES" } });
    expect((await check({ address: "198.51.100.1" })).statusCode).toBe(200);
    await letPass(901);
    expect((await check()).statusCode).toBe(200);
  });

  it("lets families behind one shared address read their own, up to a far limit", async () => {
    await register(await openCycle());
    for (let index = 0; index < 40; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await check()).statusCode).toBe(200);
    }
    expect((await check({ nik: WRONG_NIK })).statusCode).toBe(404);

    await db
      .insert(schema.statusCheckTries)
      .values(Array.from({ length: 260 }, () => ({ subject: "RIGHT 203.0.113.7" })));
    expect((await check()).statusCode).toBe(429);
    expect((await check({ address: "198.51.100.1" })).statusCode).toBe(200);
  });

  it("holds the far limit against right answers that arrive at once", async () => {
    await register(await openCycle());
    await db
      .insert(schema.statusCheckTries)
      .values(Array.from({ length: 298 }, () => ({ subject: "RIGHT 203.0.113.7" })));
    const statuses = await Promise.all(Array.from({ length: 12 }, () => check()));
    expect(
      count(
        statuses.map(({ statusCode }) => statusCode),
        200,
      ),
    ).toBe(2);
    expect(await lookups()).toHaveLength(2);
  });

  it("does not use up an address with tries on a number that is locked", async () => {
    await register(await openCycle());
    await wrongTries(5);
    for (let index = 0; index < 25; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await check()).statusCode).toBe(429);
    }
    expect((await check({ number: "SMP-0500" })).statusCode).toBe(404);
  });

  it("does not use up an address with tries that lost the race for a number", async () => {
    for (let round = 1; round <= 5; round += 1) {
      const number = `SMP-${900 + round}`;
      // oxlint-disable-next-line eslint/no-await-in-loop
      await wrongTries(4, number);
      // oxlint-disable-next-line eslint/no-await-in-loop
      const raced = await Promise.all([1, 2, 3].map(() => check({ number, nik: WRONG_NIK })));
      expect(
        count(
          raced.map(({ statusCode }) => statusCode),
          404,
        ),
      ).toBe(1);
    }
    expect(
      await db.$count(
        schema.statusCheckTries,
        eq(schema.statusCheckTries.subject, "ADDRESS 203.0.113.7"),
      ),
    ).toBe(5);
  });

  it("leaves the database to everyone else while hundreds of lookups wait", async () => {
    await register(await openCycle());
    const { release, unlocked } = await lockTable(db, "status_check_tries");
    const flood = Array.from({ length: 300 }, (_, index) =>
      check({ address: `198.51.100.${index % 250}` }).then(({ statusCode }) => statusCode),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Through the API's own connections, which the flood would have taken.
    expect((await currentCycle()).statusCode).toBe(200);
    release();
    await unlocked;
    const statuses = await Promise.all(flood);
    expect(count(statuses, 500)).toBe(0);
    expect(count(statuses, 429)).toBeGreaterThanOrEqual(97);
  }, 30_000);

  it("counts a whole IPv6 network as one address", async () => {
    for (let index = 1; index <= 20; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await check({ number: `SMP-${index}`, address: `2001:db8:1:1::${index}` });
    }
    expect((await check({ address: "2001:db8:1:1::ffff" })).statusCode).toBe(429);
    expect((await check({ address: "2001:db8:1:2::1" })).statusCode).toBe(404);
  });

  it("never touches sign-in or the account's own pages", async () => {
    const applicationId = await register(await openCycle());
    const cookie = await sessionCookie(app.auth.FAMILY, "family-a");
    for (let index = 0; index < 21; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await check({ nik: WRONG_NIK, number: `SMP-${1 + (index % 5)}` });
    }
    expect((await check()).statusCode).toBe(429);

    const headers = {
      host: FAMILY_HOST,
      "x-forwarded-for": "203.0.113.7",
      "content-type": "application/json",
    };
    const code = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers,
      payload: { email: "wali@example.test", type: "sign-in" },
    });
    expect(code.statusCode).toBe(200);
    // The send runs on after the answer, and would collide with the next reset.
    await vi.waitFor(async () => {
      const sent = await db
        .select({ status: schema.notifications.status })
        .from(schema.notifications)
        .where(eq(schema.notifications.recipient, "wali@example.test"));
      expect(sent).toEqual([{ status: "SENT" }]);
    });
    const own = await app.inject({
      method: "POST",
      url: "/api/rpc/applicant/applications/get",
      headers: { ...headers, cookie },
      payload: { json: { applicationId } },
    });
    expect(own.statusCode).toBe(200);
  });

  it("keeps a day of tries and no more", async () => {
    await wrongTries(5);
    await letPass(86_401);
    await check({ number: "SMP-0500" });
    expect(await db.$count(schema.statusCheckTries)).toBe(2);
  });
});

describe("the record", () => {
  it("writes who looked and what they found, and nothing about the child", async () => {
    const id = await register(await openCycle());
    const response = await check();
    await check({ nik: WRONG_NIK });

    const [found, missed] = await lookups();
    const everyRow = {
      actorType: "PUBLIC",
      actorId: null,
      entityType: "application",
      ipAddress: "203.0.113.7",
      userAgent: "grandma-phone",
    };
    expect(found).toMatchObject({
      ...everyRow,
      entityId: id,
      metadata: { found: true },
      requestId: response.headers["x-request-id"],
    });
    expect(missed).toMatchObject({ ...everyRow, entityId: "unknown", metadata: { found: false } });
  });

  it("names the account when the visitor is signed in", async () => {
    await register(await openCycle());
    await check({ cookie: await sessionCookie(app.auth.FAMILY, "family-a") });
    expect(await lookups()).toMatchObject([{ actorType: "FAMILY", actorId: "family-a" }]);
  });

  it("does not grow for refused tries", async () => {
    await register(await openCycle());
    await wrongTries(9);
    expect(await lookups()).toHaveLength(5);
  });

  it("keeps NIK and name out of the logs, the audit rows and the counts", async () => {
    await register(await openCycle());
    logLines.length = 0;
    const headers = { host: FAMILY_HOST, "content-type": "application/json" };
    const responses = [
      await check(),
      await check({ nik: WRONG_NIK }),
      // The NIK in the wrong field, alone and behind a school.
      await check({ number: NIK, nik: "SMP-0001" }),
      await check({ number: `SMP-${NIK}` }),
      // Refused tries.
      await check({ nik: WRONG_NIK }),
      await check({ nik: WRONG_NIK }),
      await check({ nik: WRONG_NIK }),
      await check({ nik: WRONG_NIK }),
      await check({ nik: WRONG_NIK }),
      // Not what the app sends.
      await app.inject({
        method: "POST",
        url: PATH,
        headers,
        payload: `{"json":{"nik":"${NIK}",`,
      }),
      await app.inject({
        method: "POST",
        url: PATH,
        headers,
        payload: { json: { registrationNumber: Number(NIK), nik: [NIK] } },
      }),
      await app.inject({
        method: "GET",
        url: `${PATH}?data=${encodeURIComponent(JSON.stringify({ json: { registrationNumber: "SMP-0001", nik: NIK } }))}`,
        headers: { host: FAMILY_HOST },
      }),
    ];
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([
      200, 404, 404, 404, 404, 404, 404, 404, 429, 400, 400, 405,
    ]);
    // A database that fails in the middle of a lookup.
    await db.execute(sql`alter table admission_cycles rename to admission_cycles_away`);
    const failed = await check({ number: "SMP-0002" }).finally(() =>
      db.execute(sql`alter table admission_cycles_away rename to admission_cycles`),
    );
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain(NIK);
    expect(logLines.join("")).toContain("unexpected error in procedure");

    const rows = JSON.stringify([
      await db.select().from(schema.auditLogs),
      await db.select().from(schema.statusCheckTries),
    ]);
    expect(rows).not.toMatch(/6472014105|Aisyah/);
    expect(logLines.length).toBeGreaterThan(20);
    expect(logLines.join("")).not.toMatch(/6472014105|Aisyah/);
  });
});

describe("the host", () => {
  it.each([
    ["the committee app's", STAFF_HOST],
    ["the API's own", "localhost:3001"],
  ])("has no such route on %s host", async (_, host) => {
    await register(await openCycle());
    const lookup = await check({ host });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/rpc/public/application/noSuchThing",
      headers: { host, "content-type": "application/json" },
      payload: { json: {} },
    });
    expect(lookup.statusCode).toBe(404);
    expect(lookup.body).toBe(unknown.body);
    expect(await db.$count(schema.statusCheckTries)).toBe(0);
    expect(await lookups()).toEqual([]);
  });

  it("still serves the profile its cycle on the API's own host", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rpc/public/admission/getCurrentCycle",
      headers: { host: "api:3001", "content-type": "application/json" },
      payload: { json: { schoolKey: "smp" } },
    });
    expect(response.statusCode).toBe(200);
  });
});
