import type { ApplicantProfileInput, AppliedCommand, SchoolKey } from "@mbs/api-contract";
import { schema } from "@mbs/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { FAMILY_HOST, testConfig } from "../../test/config.ts";
import { resetTables } from "../../test/reset.ts";
import { sessionCookie } from "../auth/auth.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { applyCommand, saveProfile, type Actor } from "./service.ts";

const app = await buildApp(testConfig());
const db = app.db;
const OUTBOX = { familyAppUrl: "http://localhost:5173" };
const DAY = 86_400_000;

beforeAll(() => app.ready());
afterAll(() => app.close());

const staff: StaffContext = {
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "Panitia",
  role: "STAFF",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-staff",
};
const STAFF: Actor = { type: "STAFF", staff };
const FAMILY: Actor = { type: "FAMILY", userId: "family-a" };

const NIK = "6472010101010001";
function profile(overrides: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput {
  return {
    childFullName: "Aisyah Putri",
    nik: NIK,
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi",
    guardianRelation: "FATHER",
    guardianPhone: "0812 3456 7890",
    ...overrides,
  };
}

let cycleId: string;
let cookieA: string;
let cookieB: string;

beforeEach(async () => {
  await resetTables(db, [
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
  await db.insert(schema.user).values(
    ["family-a", "family-b"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      updatedAt: new Date(),
    })),
  );
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name: "2027/2028",
      registrationOpenAt: new Date(Date.now() - DAY),
      registrationCloseAt: new Date(Date.now() + 30 * DAY),
      resultPublishAt: new Date("2027-01-15T00:00:00Z"),
      defaultFee: 250_000,
      status: "OPEN",
    })
    .returning();
  cycleId = cycle!.id;
  cookieA = await sessionCookie(app.auth.FAMILY, "family-a");
  cookieB = await sessionCookie(app.auth.FAMILY, "family-b");
});

function call(path: string, json: unknown, cookie = cookieA) {
  return app.inject({
    method: "POST",
    url: `/api/rpc/applicant/applications/${path}`,
    headers: {
      host: FAMILY_HOST,
      cookie,
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "family-phone",
    },
    payload: { json },
  });
}

function submit(
  options: {
    key?: string;
    schoolKey?: SchoolKey;
    profile?: ApplicantProfileInput;
    cookie?: string;
  } = {},
) {
  return call(
    "submit",
    {
      cycleId,
      schoolKey: options.schoolKey ?? "smp",
      profile: options.profile ?? profile(),
      idempotencyKey: options.key ?? crypto.randomUUID(),
    },
    options.cookie,
  );
}

async function submitted(options?: Parameters<typeof submit>[0]) {
  const response = await submit(options);
  expect(response.statusCode).toBe(200);
  return response.json<{ json: { applicationId: string } }>().json.applicationId;
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
  [STAFF, "REJECT_PAYMENT", { reason: "Nominal pada foto tidak terbaca." }],
  [FAMILY, "UPLOAD_PAYMENT_PROOF"],
  [STAFF, "APPROVE_PAYMENT"],
  [STAFF, "ADD_NOTE", { note: "CATATAN-RAHASIA" }],
  [FAMILY, "SUBMIT_DOCUMENTS"],
  [STAFF, "VERIFY_DOCUMENTS"],
  [STAFF, "ADVANCE_TO_INTERVIEW"],
  [STAFF, "SCHEDULE_INTERVIEW"],
  [STAFF, "RECORD_ATTENDED"],
];

describe("submit", () => {
  it("makes one application and one email from a submit that arrives twice", async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all([submit({ key }), submit({ key }), submit({ key })]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(await db.$count(schema.applications)).toBe(1);
    expect(await db.$count(schema.notifications)).toBe(1);
  });

  it("stores what was typed in one form, with who sent it", async () => {
    const applicationId = await submitted({ profile: profile({ nik: "6472.0101 0101.0001" }) });

    const [application] = await db.select().from(schema.applications);
    expect(application).toMatchObject({ id: applicationId, nik: NIK, stage: "PAYMENT_DUE" });
    const [version] = await db.select().from(schema.applicantProfileVersions);
    expect(version!.data).toMatchObject({ nik: NIK, guardianPhone: "+6281234567890" });
    const [event] = await db.select().from(schema.applicationEvents);
    expect(event).toMatchObject({
      actorId: "family-a",
      ipAddress: "203.0.113.7",
      userAgent: "family-phone",
      requestId: expect.any(String),
    });
    const [mail] = await db.select().from(schema.notifications);
    expect(mail).toMatchObject({ templateVersion: 2, recipient: "family-a@example.test" });
    expect(mail!.bodyText).toContain("Jangan transfer dulu");
  });

  it("leads a key reused with an edited form to the application it made", async () => {
    const key = crypto.randomUUID();
    const applicationId = await submitted({ key });

    const edited = await submit({ key, profile: profile({ childFullName: "Aisyah Lain" }) });

    expect(edited.statusCode).toBe(409);
    expect(edited.json()).toMatchObject({
      json: {
        defined: true,
        code: "IDEMPOTENCY_KEY_REUSED",
        data: { applicationId, sameRegistration: true },
      },
    });
    const sibling = await submit({ key, profile: profile({ nik: "6472010101010009" }) });
    expect(sibling.json()).toMatchObject({
      json: { data: { applicationId, sameRegistration: false } },
    });
    expect(await db.$count(schema.applications)).toBe(1);
  });

  it("gives one answer to a key that races itself at two schools", async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all([
      submit({ key, schoolKey: "smp" }),
      submit({ key, schoolKey: "sma" }),
    ]);

    expect(responses.map(({ statusCode }) => statusCode).toSorted((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const [made] = await db.select().from(schema.applications);
    for (const response of responses) expect(response.body).toContain(made!.id);
  });

  it("keeps another account's key to itself", async () => {
    const key = crypto.randomUUID();
    const first = await submitted({ key });
    const second = await submitted({
      key,
      cookie: cookieB,
      profile: profile({ nik: "6472010101010002" }),
    });
    expect(second).not.toBe(first);
  });

  it("refuses the same child twice without saying anything about the first", async () => {
    await submitted();
    const response = await submit({ cookie: cookieB });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      json: { defined: true, code: "DUPLICATE_APPLICATION" },
    });
    expect(response.body).not.toMatch(/SMP-0001|Aisyah|family-a|applicationId/);
    expect(await db.$count(schema.applications)).toBe(1);
  });

  it.each([
    ["is closed", { status: "CLOSED" as const }],
    ["opens tomorrow", { registrationOpenAt: new Date(Date.now() + DAY) }],
    [
      "closed a moment ago",
      { registrationOpenAt: new Date(0), registrationCloseAt: new Date(Date.now() - 1000) },
    ],
  ])("writes nothing when registration %s", async (_, change) => {
    await db
      .update(schema.admissionCycles)
      .set(change)
      .where(eq(schema.admissionCycles.id, cycleId));
    const response = await submit();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ json: { defined: true, code: "REGISTRATION_CLOSED" } });
    expect(await db.$count(schema.applications)).toBe(0);
  });

  it("names the field a refused form got wrong, in words for the family", async () => {
    const response = await submit({ profile: profile({ nik: "123" }) });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      json: {
        code: "BAD_REQUEST",
        data: {
          issues: [{ path: ["profile", "nik"], message: expect.stringContaining("16 angka") }],
        },
      },
    });
    expect(await db.$count(schema.applications)).toBe(0);
  });

  it("takes text Postgres cannot store as it is", async () => {
    const id = await submitted({ profile: profile({ childFullName: "Aisyah\u0000 \ud800Putri" }) });
    const response = await call("get", { applicationId: id });
    expect(response.json()).toMatchObject({ json: { childName: "Aisyah Putri" } });
  });

  it("needs a family session", async () => {
    expect((await submit({ cookie: "" })).statusCode).toBe(401);
    expect((await call("list", undefined, "")).statusCode).toBe(401);
  });
});

describe("list and get", () => {
  it("lists only the applications the account was given, with the newest name", async () => {
    const first = await submitted();
    const second = await submitted({
      schoolKey: "sma",
      profile: profile({ nik: "6472010101010002", childFullName: "Umar" }),
    });
    await submitted({
      cookie: cookieB,
      profile: profile({ nik: "6472010101010003", childFullName: "Anak Lain" }),
    });
    await saveProfile(
      db,
      {
        applicationId: first,
        actor: FAMILY,
        profile: profile({ childFullName: "Aisyah Ramadhani" }),
        expectedSeq: 1,
        idempotencyKey: null,
      },
      OUTBOX,
    );

    const response = await call("list", undefined);
    expect(response.json().json).toEqual([
      {
        id: second,
        registrationNumber: "SMA-0001",
        schoolKey: "sma",
        childName: "Umar",
        stage: "PAYMENT_DUE",
      },
      {
        id: first,
        registrationNumber: "SMP-0001",
        schoolKey: "smp",
        childName: "Aisyah Ramadhani",
        stage: "PAYMENT_DUE",
      },
    ]);
  });

  it("answers another account's id exactly as an unknown one", async () => {
    const applicationId = await submitted();
    const theirs = await call("get", { applicationId }, cookieB);
    const unknown = await call("get", { applicationId: crypto.randomUUID() }, cookieB);

    expect(theirs.statusCode).toBe(404);
    expect(theirs.body).toBe(unknown.body);
  });

  it("shows what was promised and only the events the family may see", async () => {
    const [smp] = await db.select().from(schema.schools).where(eq(schema.schools.key, "smp"));
    await db.insert(schema.documentRequirements).values([
      { admissionCycleId: cycleId, schoolId: smp!.id, type: "IJAZAH", required: false },
      { admissionCycleId: cycleId, schoolId: smp!.id, type: "KARTU_KELUARGA", required: true },
    ]);
    const applicationId = await submitted();
    await db.update(schema.admissionCycles).set({ defaultFee: 999_000 });
    await walk(applicationId, TO_INTERVIEWED);

    const response = await call("get", { applicationId });
    const application = response.json().json;
    expect(application).toMatchObject({
      registrationFee: 250_000,
      resultPublishAt: "2027-01-15T00:00:00.000Z",
      documents: [
        { type: "KARTU_KELUARGA", required: true },
        { type: "IJAZAH", required: false },
      ],
      stage: "INTERVIEWED",
    });
    expect(application.events).toEqual(
      [
        ["SUBMIT", "FAMILY", null],
        ["UPLOAD_PAYMENT_PROOF", "FAMILY", null],
        ["REJECT_PAYMENT", "STAFF", "Nominal pada foto tidak terbaca."],
        ["UPLOAD_PAYMENT_PROOF", "FAMILY", null],
        ["APPROVE_PAYMENT", "STAFF", null],
        ["SUBMIT_DOCUMENTS", "FAMILY", null],
        ["VERIFY_DOCUMENTS", "STAFF", null],
        ["ADVANCE_TO_INTERVIEW", "STAFF", null],
        ["SCHEDULE_INTERVIEW", "STAFF", null],
        ["RECORD_ATTENDED", "STAFF", null],
      ].map(([command, actor, reason]) => ({ command, actor, reason, at: expect.any(String) })),
    );
    // NIK, staff, notes, request details and anything that counts hidden events.
    expect(response.body).not.toMatch(
      /6472010101010001|CATATAN|0000000000aa|203\.0\.113|family-phone|payload|seq|fromStage|toStage/i,
    );
  });

  it("answers the same before and after the committee decides", async () => {
    const applicationId = await submitted();
    await walk(applicationId, TO_INTERVIEWED);
    const before = [await call("get", { applicationId }), await call("list", undefined)].map(
      (response) => response.body,
    );

    await walk(
      applicationId,
      [
        [STAFF, "DECIDE", { decision: "NOT_ACCEPTED" }],
        [STAFF, "DECIDE", { decision: "ACCEPTED" }],
        [STAFF, "ADD_NOTE", { note: "Diterima." }],
      ],
      TO_INTERVIEWED.length + 1,
    );
    const after = [await call("get", { applicationId }), await call("list", undefined)].map(
      (response) => response.body,
    );

    expect(after).toEqual(before);
    expect(after.join()).not.toMatch(/DECIDE|ACCEPTED/);
  });

  it("keeps the family's own reason out of the committee's notes", async () => {
    const applicationId = await submitted();
    await walk(applicationId, [[FAMILY, "WITHDRAW", { reason: "Pindah kota." }]]);
    const response = await call("get", { applicationId });
    expect(response.json().json.events.at(-1)).toMatchObject({
      command: "WITHDRAW",
      actor: "FAMILY",
      reason: null,
    });
  });
});
