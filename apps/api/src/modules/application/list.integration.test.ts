import type {
  ApplicantProfileInput,
  AppliedCommand,
  CommitteeApplication,
  CommitteeApplicationPage,
  CommitteeDashboard,
  FamilyApplication,
  SchoolKey,
  StaffRole,
} from "@mbs/api-contract";
import { schema } from "@mbs/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { FAMILY_HOST, STAFF_HOST, testConfig } from "../../test/config.ts";
import { resetTables } from "../../test/reset.ts";
import { sessionCookie } from "../auth/auth.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { applyCommand, submitApplication, type Actor } from "./service.ts";

const app = await buildApp(testConfig());
const db = app.db;
const OUTBOX = { familyAppUrl: "http://localhost:5173" };
const DAY = 86_400_000;
const FAMILY: Actor = { type: "FAMILY", userId: "family-a" };

beforeAll(() => app.ready());
afterAll(() => app.close());

let cycleId: string;
/** Acts in every school, so the setup can walk any application. */
let walker: Actor;

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
    schema.staffSchoolAccess,
    schema.staffLoginEmails,
    schema.staffUsers,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
  await db.insert(schema.user).values({
    id: "family-a",
    name: "family-a",
    email: "keluarga@example.test",
    emailVerified: true,
    updatedAt: new Date(),
  });
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name: "PPDB 2027/2028",
      registrationOpenAt: new Date(Date.now() - DAY),
      registrationCloseAt: new Date(Date.now() + 30 * DAY),
      resultPublishAt: new Date(Date.now() + 60 * DAY),
      defaultFee: 250_000,
      status: "OPEN",
    })
    .returning();
  cycleId = cycle!.id;
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ name: "Ust. Hasan", role: "STAFF" })
    .returning();
  const staff: StaffContext = {
    id: row!.id,
    name: row!.name,
    role: "STAFF",
    schoolKeys: ["smp", "smk", "sma"],
    authUserId: "auth-walker",
  };
  walker = { type: "STAFF", staff };
});

let nikSeq = 0;
function profile(overrides: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput {
  nikSeq += 1;
  return {
    childFullName: "Aisyah Putri",
    nik: `64720101010${String(nikSeq).padStart(5, "0")}`,
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi Santoso",
    guardianRelation: "FATHER",
    guardianPhone: "0812 3456 7890",
    ...overrides,
  };
}

async function register(
  schoolKey: SchoolKey,
  overrides: Partial<ApplicantProfileInput> = {},
  userId = "family-a",
) {
  const { application } = await submitApplication(
    db,
    {
      cycleId,
      schoolKey,
      userId,
      profile: profile(overrides),
      idempotencyKey: null,
    },
    OUTBOX,
  );
  return application.id;
}

async function walk(applicationId: string, steps: [Actor, AppliedCommand, object?][]) {
  const [row] = await db
    .select({ seq: schema.applications.lastEventSeq })
    .from(schema.applications)
    .where(eq(schema.applications.id, applicationId));
  const seq = row!.seq;
  for (const [index, [actor, command, payload]] of steps.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await applyCommand(
      db,
      {
        applicationId,
        actor,
        command,
        payload: { payloadVersion: 1, ...payload },
        expectedSeq: seq + index,
        idempotencyKey: null,
      },
      OUTBOX,
    );
  }
}

function toPaid(): [Actor, AppliedCommand, object?][] {
  return [
    [FAMILY, "UPLOAD_PAYMENT_PROOF"],
    [walker, "APPROVE_PAYMENT"],
  ];
}
function toInterviewed(): [Actor, AppliedCommand, object?][] {
  return [
    ...toPaid(),
    [FAMILY, "SUBMIT_DOCUMENTS"],
    [walker, "VERIFY_DOCUMENTS"],
    [walker, "ADVANCE_TO_INTERVIEW"],
    [walker, "SCHEDULE_INTERVIEW"],
    [walker, "RECORD_ATTENDED"],
  ];
}

async function signIn(
  role: StaffRole,
  schools: SchoolKey[],
  name = `${role} ${schools.join(" ")}`,
) {
  const email = `${role.toLowerCase()}-${schools.join("-") || "none"}@mbss.sch.id`;
  const [staff] = await db.insert(schema.staffUsers).values({ name, role }).returning();
  await db
    .insert(schema.staffLoginEmails)
    .values({ staffId: staff!.id, email, kind: "INSTITUTIONAL" });
  if (schools.length > 0) {
    const rows = await db.select().from(schema.schools);
    await db
      .insert(schema.staffSchoolAccess)
      .values(
        rows
          .filter((school) => (schools as string[]).includes(school.key))
          .map((school) => ({ staffId: staff!.id, schoolId: school.id })),
      );
  }
  const auth = await app.auth.STAFF.$context;
  const { user } = await auth.internalAdapter.createOAuthUser(
    { email, name, emailVerified: true },
    { providerId: "google", accountId: `google-${email}` },
  );
  return { cookie: await sessionCookie(app.auth.STAFF, user.id), staffId: staff!.id };
}

function rpc(path: string, json: unknown, cookie: string) {
  return app.inject({
    method: "POST",
    url: `/api/rpc/staff/${path}`,
    headers: {
      host: STAFF_HOST,
      cookie,
      "content-type": "application/json",
      "user-agent": "laptop",
    },
    payload: { json },
  });
}

async function ok<T>(path: string, json: unknown, cookie: string) {
  const response = await rpc(path, json, cookie);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ json: T }>().json;
}

const list = (cookie: string, input: object = {}) =>
  ok<CommitteeApplicationPage>("applications/list", { view: "ALL", page: 1, ...input }, cookie);
const detail = (cookie: string, applicationId: string) =>
  ok<CommitteeApplication>("applications/get", { applicationId }, cookie);
const note = (cookie: string, applicationId: string, text: string, key = crypto.randomUUID()) =>
  rpc("applications/addNote", { applicationId, note: text, idempotencyKey: key }, cookie);
const viewRows = () =>
  db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "application.viewed"));

describe("the committee list", () => {
  it("shows only the staff member's schools", async () => {
    const smp = await register("smp", { childFullName: "Nadia Lestari" });
    await register("smk", { childFullName: "Daeng Makkasau" });
    const { cookie } = await signIn("STAFF", ["smp"]);

    const page = await list(cookie);
    expect(page.rows.map((row) => row.id)).toEqual([smp]);
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(page.rows[0]).toMatchObject({
      childName: "Nadia Lestari",
      guardianName: "Budi Santoso",
      guardianPhone: "+6281234567890",
      schoolKey: "smp",
      stage: "PAYMENT_DUE",
      needsCommittee: false,
      lastActivity: { command: "SUBMIT", actorType: "FAMILY" },
    });

    expect((await list(cookie, { school: "smk" })).rows).toEqual([]);
  });

  it("shows nothing to a staff member with no school", async () => {
    await register("smp");
    const { cookie } = await signIn("STAFF", []);

    expect(await list(cookie)).toMatchObject({ rows: [], total: 0 });
    expect(await ok<CommitteeDashboard>("dashboard/get", {}, cookie)).toMatchObject({
      total: 0,
      perSchool: [],
      recent: [],
    });
  });

  it("finds a child by guardian name or number, never by NIK", async () => {
    const found = await register("smp", {
      guardianName: "Rina 100%_Lestari",
      nik: "6472000000000777",
    });
    await register("smp", { guardianName: "Ahmad Fauzi" });
    const { cookie } = await signIn("STAFF", ["smp"]);

    expect((await list(cookie, { q: "100%_les" })).rows.map((row) => row.id)).toEqual([found]);
    expect((await list(cookie, { q: "smp-0001" })).rows.map((row) => row.id)).toEqual([found]);
    expect((await list(cookie, { q: "6472000000000777" })).total).toBe(0);
    expect((await list(cookie, { q: "Rina_100" })).total).toBe(0);
  });

  it("puts the longest wait first under Perlu dicek, and leaves out what the family owes", async () => {
    const first = await register("smp");
    const second = await register("smp");
    await register("smp");
    await walk(first, [[FAMILY, "UPLOAD_PAYMENT_PROOF"]]);
    await walk(second, [[FAMILY, "UPLOAD_PAYMENT_PROOF"]]);
    const { cookie } = await signIn("STAFF", ["smp"]);

    const waiting = await list(cookie, { view: "NEEDS_COMMITTEE" });
    expect(waiting.rows.map((row) => row.id)).toEqual([first, second]);
    expect(waiting.rows.every((row) => row.needsCommittee)).toBe(true);
    expect((await list(cookie)).rows[0]!.id).toBe(second);
  });

  it("pages 50 rows at a time", async () => {
    const accounts = Array.from({ length: 6 }, (_, i) => `family-${i}`);
    await db.insert(schema.user).values(
      accounts.map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
        updatedAt: new Date(),
      })),
    );
    for (let i = 0; i < 52; i += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await register("smp", {}, accounts[i % accounts.length]);
    }
    const { cookie } = await signIn("STAFF", ["smp"]);

    const first = await list(cookie);
    const second = await list(cookie, { page: 2 });
    expect([first.rows.length, second.rows.length, second.total]).toEqual([50, 2, 52]);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(52);
  });

  it("reads the open cycle, not an older closed one", async () => {
    await register("smp");
    await db.insert(schema.admissionCycles).values({
      name: "PPDB lama",
      registrationOpenAt: new Date(Date.now() + 90 * DAY),
      registrationCloseAt: new Date(Date.now() + 120 * DAY),
      resultPublishAt: new Date(Date.now() + 150 * DAY),
      defaultFee: 0,
      status: "CLOSED",
    });
    const { cookie } = await signIn("STAFF", ["smp"]);

    expect((await list(cookie)).total).toBe(1);
  });
});

describe("one application for the committee", () => {
  it("answers NOT_FOUND for another school's application, on every call", async () => {
    const smp = await register("smp");
    const { cookie } = await signIn("STAFF", ["smk"]);

    for (const response of [
      await rpc("applications/get", { applicationId: smp }, cookie),
      await rpc("applications/recordView", { applicationId: smp }, cookie),
      await note(cookie, smp, "Bukan sekolah saya."),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ json: { code: "NOT_FOUND" } });
    }
    expect(await viewRows()).toEqual([]);
  });

  it("shows every event with its actor, plus the views and status checks", async () => {
    const id = await register("smp");
    await walk(id, [
      [FAMILY, "UPLOAD_PAYMENT_PROOF"],
      [walker, "REJECT_PAYMENT", { reason: "Nominal tidak terbaca." }],
    ]);
    const checked = await app.inject({
      method: "POST",
      url: "/api/rpc/public/application/checkStatus",
      headers: { host: FAMILY_HOST, "content-type": "application/json" },
      payload: { json: { registrationNumber: "SMP-0001", nik: await nikOf(id) } },
    });
    expect(checked.statusCode).toBe(200);
    const { cookie } = await signIn("STAFF", ["smp"], "Pak Rudi");
    await ok("applications/recordView", { applicationId: id }, cookie);

    const application = await detail(cookie, id);
    expect(application).toMatchObject({
      registrationNumber: "SMP-0001",
      stage: "PAYMENT_DUE",
      lastEventSeq: 3,
      accountEmail: "keluarga@example.test",
      canAddNote: true,
      profile: { childFullName: "Aisyah Putri", nik: await nikOf(id) },
    });
    expect(
      application.history.map((item) => (item.kind === "EVENT" ? item.command : item.action)),
    ).toEqual([
      "application.viewed",
      "application.status_checked",
      "REJECT_PAYMENT",
      "UPLOAD_PAYMENT_PROOF",
      "SUBMIT",
    ]);
    expect(application.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "application.viewed",
          actor: { type: "STAFF", name: "Pak Rudi" },
        }),
        expect.objectContaining({
          action: "application.status_checked",
          actor: { type: "PUBLIC" },
        }),
        expect.objectContaining({
          command: "REJECT_PAYMENT",
          actor: { type: "STAFF", name: "Ust. Hasan" },
          text: "Nominal tidak terbaca.",
        }),
        expect.objectContaining({
          command: "SUBMIT",
          actor: { type: "FAMILY", name: "Budi Santoso" },
        }),
      ]),
    );
  });

  it("names the guardian only for a status check from the child's own family", async () => {
    const id = await register("smp");
    await db.insert(schema.user).values({
      id: "family-b",
      name: "family-b",
      email: "lain@example.test",
      emailVerified: true,
      updatedAt: new Date(),
    });
    for (const account of ["family-b", "family-a"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const checked = await app.inject({
        method: "POST",
        url: "/api/rpc/public/application/checkStatus",
        headers: {
          host: FAMILY_HOST,
          // oxlint-disable-next-line eslint/no-await-in-loop
          cookie: await sessionCookie(app.auth.FAMILY, account),
          "content-type": "application/json",
        },
        payload: { json: { registrationNumber: "SMP-0001", nik: await nikOf(id) } },
      });
      expect(checked.statusCode).toBe(200);
    }
    const { cookie } = await signIn("STAFF", ["smp"]);

    const checks = (await detail(cookie, id)).history.filter((item) => item.kind === "AUDIT");
    expect(checks.map((item) => item.actor)).toEqual([
      { type: "FAMILY", name: "Budi Santoso" },
      { type: "OTHER_ACCOUNT" },
    ]);
  });

  it("writes nothing when read, and one view row with the request id when recorded", async () => {
    const id = await register("smp");
    const { cookie, staffId } = await signIn("STAFF", ["smp"]);

    await detail(cookie, id);
    await detail(cookie, id);
    expect(await viewRows()).toEqual([]);

    const response = await rpc("applications/recordView", { applicationId: id }, cookie);
    expect(response.statusCode).toBe(200);
    const rows = await viewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "STAFF",
      actorId: staffId,
      entityType: "application",
      entityId: id,
      requestId: response.headers["x-request-id"],
      userAgent: "laptop",
      metadata: null,
    });
  });
});

describe("notes", () => {
  it("lets a principal read but not write a note", async () => {
    const id = await register("smp");
    const { cookie } = await signIn("PRINCIPAL", ["smp"]);

    expect((await detail(cookie, id)).canAddNote).toBe(false);
    const response = await note(cookie, id, "Kepala sekolah menulis.");
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ json: { code: "FORBIDDEN" } });
  });

  it("saves a note after someone else moved the application, and only once per key", async () => {
    const id = await register("smp");
    const { cookie } = await signIn("STAFF", ["smp"]);
    const loaded = await detail(cookie, id);
    await walk(id, [[FAMILY, "UPLOAD_PAYMENT_PROOF"]]);

    const key = crypto.randomUUID();
    const first = await note(cookie, id, "Wali minta jadwal pagi.\nSudah disesuaikan.", key);
    const again = await note(cookie, id, "Wali minta jadwal pagi.\nSudah disesuaikan.", key);
    expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
    expect(first.json().json.seq).toBe(loaded.lastEventSeq + 2);
    expect(again.json().json.seq).toBe(first.json().json.seq);

    const notes = (await detail(cookie, id)).history.filter(
      (item) => item.kind === "EVENT" && item.command === "ADD_NOTE",
    );
    expect(notes).toEqual([
      expect.objectContaining({
        text: "Wali minta jadwal pagi.\nSudah disesuaikan.",
        familyVisible: false,
      }),
    ]);
  });

  it("keeps a note from the family", async () => {
    const id = await register("smp");
    const { cookie } = await signIn("STAFF", ["smp"]);
    expect((await note(cookie, id, "CATATAN-RAHASIA")).statusCode).toBe(200);

    const family = await app.inject({
      method: "POST",
      url: "/api/rpc/applicant/applications/get",
      headers: {
        host: FAMILY_HOST,
        cookie: await sessionCookie(app.auth.FAMILY, "family-a"),
        "content-type": "application/json",
      },
      payload: { json: { applicationId: id } },
    });
    expect(family.statusCode).toBe(200);
    const seen = family.json<{ json: FamilyApplication }>().json;
    expect(seen.events.map((event) => event.command)).toEqual(["SUBMIT"]);
    expect(family.body).not.toContain("CATATAN-RAHASIA");
  });

  it("is not offered once an application has ended", async () => {
    const id = await register("smp");
    await walk(id, [[walker, "WITHDRAW"]]);
    const { cookie } = await signIn("STAFF", ["smp"]);

    expect((await detail(cookie, id)).canAddNote).toBe(false);
  });
});

describe("the dashboard", () => {
  it("counts the cycle in the staff member's schools", async () => {
    const accepted = await register("smp", { childFullName: "Fikri Al Ghifari" });
    const notAccepted = await register("smp");
    const paidOnly = await register("smp");
    await register("smp");
    await register("smk");
    await walk(accepted, [
      ...toInterviewed(),
      [walker, "DECIDE", { decision: "NOT_ACCEPTED" }],
      [walker, "DECIDE", { decision: "ACCEPTED" }],
    ]);
    await walk(notAccepted, [...toInterviewed(), [walker, "DECIDE", { decision: "NOT_ACCEPTED" }]]);
    await walk(paidOnly, toPaid());
    const { cookie } = await signIn("STAFF", ["smp", "sma"]);

    const dashboard = await ok<CommitteeDashboard>("dashboard/get", {}, cookie);
    expect(dashboard).toMatchObject({
      cycle: { name: "PPDB 2027/2028" },
      total: 4,
      newThisWeek: 4,
      paid: 3,
      needsCommittee: 0,
      oldestWaitingSince: null,
      decided: 2,
      accepted: 1,
      perSchool: [
        { schoolKey: "smp", total: 4 },
        { schoolKey: "sma", total: 0 },
      ],
    });
    expect(dashboard.recent).toHaveLength(5);
    expect(dashboard.recent[0]).toMatchObject({
      applicationId: paidOnly,
      command: "APPROVE_PAYMENT",
      actor: { type: "STAFF", name: "Ust. Hasan" },
    });
  });

  it("leaves a child who withdrew after acceptance out of the decided and accepted counts", async () => {
    const stays = await register("smp");
    const leaves = await register("smp");
    for (const id of [stays, leaves]) {
      await walk(id, [...toInterviewed(), [walker, "DECIDE", { decision: "ACCEPTED" }]]);
    }
    await walk(leaves, [[walker, "WITHDRAW"]]);
    const { cookie } = await signIn("STAFF", ["smp"]);

    expect(await ok<CommitteeDashboard>("dashboard/get", {}, cookie)).toMatchObject({
      total: 2,
      decided: 1,
      accepted: 1,
    });
  });

  it("names the oldest wait, and says zero for an empty cycle", async () => {
    const { cookie } = await signIn("STAFF", ["smp"]);
    expect(await ok<CommitteeDashboard>("dashboard/get", {}, cookie)).toMatchObject({
      total: 0,
      paid: 0,
      needsCommittee: 0,
      oldestWaitingSince: null,
      decided: 0,
      recent: [],
    });

    const id = await register("smp");
    await walk(id, [[FAMILY, "UPLOAD_PAYMENT_PROOF"]]);
    const [row] = await db
      .select({ changedAt: schema.applications.stageChangedAt })
      .from(schema.applications);
    const dashboard = await ok<CommitteeDashboard>("dashboard/get", {}, cookie);
    expect(dashboard).toMatchObject({ needsCommittee: 1 });
    expect(dashboard.oldestWaitingSince).toBe(row!.changedAt.toISOString());
  });
});

async function nikOf(applicationId: string) {
  const [row] = await db.execute<{ nik: string }>(
    sql`select nik from applications where id = ${applicationId}`,
  );
  return row!.nik;
}
