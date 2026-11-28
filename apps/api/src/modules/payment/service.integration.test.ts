import type { ApplicantProfileInput, SchoolKey } from "@mbs/api-contract";
import { createDatabase, schema, type Database } from "@mbs/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AlreadyHandledError, ForbiddenError, NotFoundError } from "../../errors.ts";
import { resetTables } from "../../test/reset.ts";
import { submitApplication } from "../application/service.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { createFiles, type Storage } from "../files/service.ts";
import * as payment from "./service.ts";

const OUTBOX = { familyAppUrl: "http://localhost:5173" };
const SECRET = "test-secret-that-is-long-enough-to-pass";
const DAY = 86_400_000;
const FEE = 250_000;

const db: Database = createDatabase(
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
);

afterAll(() => db.$client.end());

/**
 * The bucket, as far as this module can see it: a map of key to size. The real
 * one is MinIO in the verify stack; bytes never pass through the API either way.
 */
function fakeStorage() {
  const objects = new Map<string, number>();
  const storage: Storage = {
    signUpload: async ({ key, byteSize }) => {
      objects.set(key, byteSize);
      return `https://bucket.test/${key}?signed`;
    },
    signDownload: async ({ key }) => `https://bucket.test/${key}?get`,
    head: async (key) => {
      const byteSize = objects.get(key);
      return byteSize === undefined ? null : { byteSize };
    },
  };
  return { storage, objects };
}

let files: ReturnType<typeof createFiles>;
let objects: Map<string, number>;

const staff: StaffContext = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "Panitia",
  role: "STAFF",
  schoolKeys: ["smp", "smk", "sma"],
  authUserId: "auth-staff",
};
const otherStaff: StaffContext = { ...staff, schoolKeys: ["sma"] };
const principal: StaffContext = { ...staff, role: "PRINCIPAL" };

function profile(overrides: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput {
  return {
    childFullName: "Aisyah Putri",
    nik: "6472 0101 0101 0001",
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi",
    guardianRelation: "FATHER",
    guardianPhone: "081234567890",
    ...overrides,
  };
}

let cycleId: string;

beforeEach(async () => {
  await resetTables(db, [
    schema.auditLogs,
    schema.paymentReviews,
    schema.payments,
    schema.files,
    schema.applicationEvents,
    schema.applicantProfileVersions,
    schema.applicationDocumentRequirements,
    schema.applicationAccess,
    schema.applications,
    schema.documentRequirements,
    schema.schoolAdmissionSettings,
    schema.admissionCycles,
    schema.staffUsers,
    schema.user,
  ]);
  await db
    .insert(schema.schools)
    .values([{ key: "smp" }, { key: "smk" }, { key: "sma" }])
    .onConflictDoNothing();
  await db.insert(schema.user).values(
    ["family-1", "family-2"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      updatedAt: new Date(),
    })),
  );
  await db.insert(schema.staffUsers).values({ id: staff.id, name: staff.name, role: "STAFF" });
  const [cycle] = await db
    .insert(schema.admissionCycles)
    .values({
      name: "2027/2028",
      registrationOpenAt: new Date(Date.now() - DAY),
      registrationCloseAt: new Date(Date.now() + 30 * DAY),
      resultPublishAt: new Date(Date.now() + 60 * DAY),
      defaultFee: FEE,
      bankName: "Bank Kaltimtara",
      bankAccountNumber: "0051234567",
      bankAccountHolder: "Yayasan Madina",
      status: "OPEN",
    })
    .returning();
  cycleId = cycle!.id;

  const fake = fakeStorage();
  objects = fake.objects;
  files = createFiles(fake.storage, SECRET, 900);
});

async function register(options: { userId?: string; schoolKey?: SchoolKey } = {}) {
  const { application } = await submitApplication(
    db,
    {
      cycleId,
      schoolKey: options.schoolKey ?? "smp",
      userId: options.userId ?? "family-1",
      profile: options.userId === "family-2" ? profile({ nik: "6472010101010002" }) : profile(),
      idempotencyKey: crypto.randomUUID(),
    },
    OUTBOX,
  );
  return application;
}

const FILE = { contentType: "image/jpeg" as const, byteSize: 480_000, sha256: "aGFzaA==" };

async function upload(applicationId: string, userId = "family-1", key = crypto.randomUUID()) {
  const signed = await payment.beginProofUpload(db, files, { userId }, { applicationId, ...FILE });
  await payment.sendProof(
    db,
    files,
    { userId },
    { applicationId, token: signed.token, idempotencyKey: key },
    {},
    OUTBOX,
  );
  return signed;
}

async function waitingProofId(applicationId: string) {
  const [row] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.applicationId, applicationId));
  return row!.id;
}

describe("a family paying", () => {
  it("shows the fee it registered with and the cycle's account", async () => {
    const application = await register();

    const page = await payment.loadPaymentPage(db, files, { userId: "family-1" }, application.id);

    expect(page).toMatchObject({
      amountDue: FEE,
      stage: "PAYMENT_DUE",
      account: {
        bankName: "Bank Kaltimtara",
        accountNumber: "0051234567",
        accountHolder: "Yayasan Madina",
      },
      attempts: [],
    });
  });

  it("refuses another family's application as if it were not there", async () => {
    const application = await register();

    await expect(
      payment.loadPaymentPage(db, files, { userId: "family-2" }, application.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a receipt that is over the cap", async () => {
    const application = await register();

    await expect(
      payment.beginProofUpload(
        db,
        files,
        { userId: "family-1" },
        { applicationId: application.id, ...FILE, byteSize: 11 * 1024 * 1024 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes one file, one payment and one event when the bytes have landed", async () => {
    const application = await register();

    await upload(application.id);

    const page = await payment.loadPaymentPage(db, files, { userId: "family-1" }, application.id);
    expect(page.stage).toBe("PAYMENT_REVIEW");
    expect(page.attempts).toHaveLength(1);
    expect(page.attempts[0]).toMatchObject({
      decision: null,
      reason: null,
      file: { contentType: FILE.contentType, byteSize: FILE.byteSize },
    });
    const stored = await db.select().from(schema.files);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.objectKey).toMatch(/^payment-proofs\//);
  });

  it("refuses a proof whose bytes never reached the bucket", async () => {
    const application = await register();
    const signed = await payment.beginProofUpload(
      db,
      files,
      { userId: "family-1" },
      { applicationId: application.id, ...FILE },
    );
    objects.clear();

    await expect(
      payment.sendProof(
        db,
        files,
        { userId: "family-1" },
        { applicationId: application.id, token: signed.token, idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      ),
    ).rejects.toThrow(/never reached/);
  });

  it("refuses an upload that was signed for another account", async () => {
    const mine = await register();
    const theirs = await register({ userId: "family-2", schoolKey: "smk" });
    const signed = await payment.beginProofUpload(
      db,
      files,
      { userId: "family-2" },
      { applicationId: theirs.id, ...FILE },
    );

    await expect(
      payment.sendProof(
        db,
        files,
        { userId: "family-1" },
        { applicationId: mine.id, token: signed.token, idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      ),
    ).rejects.toThrow(/not the one that was signed/);
  });

  it("sends one proof however many times a cut network retries it", async () => {
    const application = await register();
    const key = crypto.randomUUID();

    const signed = await payment.beginProofUpload(
      db,
      files,
      { userId: "family-1" },
      { applicationId: application.id, ...FILE },
    );
    const send = () =>
      payment.sendProof(
        db,
        files,
        { userId: "family-1" },
        { applicationId: application.id, token: signed.token, idempotencyKey: key },
        {},
        OUTBOX,
      );
    await send();
    await send();

    expect(await db.select().from(schema.payments)).toHaveLength(1);
  });
});

describe("the committee deciding", () => {
  it("lists what waits, oldest first, in the caller's schools only", async () => {
    const smp = await register();
    const sma = await register({ userId: "family-2", schoolKey: "sma" });
    await upload(smp.id);
    await upload(sma.id, "family-2");

    const all = await payment.listProofQueue(db, staff, { page: 1 });
    const narrow = await payment.listProofQueue(db, otherStaff, { page: 1 });

    expect(all.total).toBe(2);
    expect(all.rows.map((row) => row.applicationId)).toEqual([smp.id, sma.id]);
    expect(all.rows[0]).toMatchObject({ amountDue: FEE, attempt: 1, childName: "Aisyah Putri" });
    expect(narrow.total).toBe(1);
    expect(narrow.rows[0]!.schoolKey).toBe("sma");
  });

  it("records one audit row each time a staff member opens a proof", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);

    const open = await payment.openProof(db, files, staff, paymentId, {});
    await payment.openProof(db, files, staff, paymentId, {});

    expect(open.url).toContain("?get");
    expect(open.canDecide).toBe(true);
    // A proof always counts itself, whatever precision its stored time has.
    expect(open.attempt).toBe(1);
    const viewed = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "file.viewed"));
    expect(viewed).toHaveLength(2);
    expect(viewed[0]!.metadata).toMatchObject({ paymentId });
    expect(JSON.stringify(viewed[0]!.metadata)).not.toContain("payment-proofs/");
  });

  it("refuses a proof from another family's school as if it were not there", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);

    await expect(payment.openProof(db, files, otherStaff, paymentId, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("lets a principal read a proof but never decide it", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);

    const open = await payment.openProof(db, files, principal, paymentId, {});

    expect(open.canDecide).toBe(false);
    await expect(
      payment.decideProof(
        db,
        principal,
        { paymentId, decision: "APPROVED", idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("moves an approved application on to documents", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);

    await payment.decideProof(
      db,
      staff,
      { paymentId, decision: "APPROVED", idempotencyKey: crypto.randomUUID() },
      {},
      OUTBOX,
    );

    const page = await payment.loadPaymentPage(db, files, { userId: "family-1" }, application.id);
    expect(page.stage).toBe("DOCUMENTS_DUE");
    expect(page.attempts[0]).toMatchObject({ decision: "APPROVED", reason: null });
    expect(await payment.listProofQueue(db, staff, { page: 1 })).toMatchObject({ total: 0 });
  });

  it("keeps a rejected attempt and its reason when a new proof arrives", async () => {
    const application = await register();
    await upload(application.id);
    const first = await waitingProofId(application.id);
    await payment.decideProof(
      db,
      staff,
      {
        paymentId: first,
        decision: "REJECTED",
        reason: "Nominalnya kurang Rp50.000.",
        idempotencyKey: crypto.randomUUID(),
      },
      {},
      OUTBOX,
    );

    await upload(application.id);

    const page = await payment.loadPaymentPage(db, files, { userId: "family-1" }, application.id);
    expect(page.stage).toBe("PAYMENT_REVIEW");
    expect(page.attempts).toHaveLength(2);
    expect(page.attempts[0]).toMatchObject({ decision: null });
    expect(page.attempts[1]).toMatchObject({
      id: first,
      decision: "REJECTED",
      reason: "Nominalnya kurang Rp50.000.",
    });
    const queue = await payment.listProofQueue(db, staff, { page: 1 });
    expect(queue.rows[0]).toMatchObject({ attempt: 2 });
    const opened = await payment.openProof(db, files, staff, queue.rows[0]!.paymentId, {});
    expect(opened.attempt).toBe(2);
  });

  it("tells the second of two staff that the proof was already handled", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);
    const decide = () =>
      payment.decideProof(
        db,
        staff,
        { paymentId, decision: "APPROVED", idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      );

    const [first, second] = await Promise.allSettled([decide(), decide()]);

    expect([first.status, second.status].toSorted()).toEqual(["fulfilled", "rejected"]);
    const refused = [first, second].find((result) => result.status === "rejected");
    expect(refused!.reason).toBeInstanceOf(AlreadyHandledError);
    expect(await db.select().from(schema.paymentReviews)).toHaveLength(1);
  });

  it("refuses a proof that a newer one replaced while the desk held it open", async () => {
    const application = await register();
    await upload(application.id);
    const stale = await waitingProofId(application.id);
    await payment.decideProof(
      db,
      staff,
      {
        paymentId: stale,
        decision: "REJECTED",
        reason: "Buram.",
        idempotencyKey: crypto.randomUUID(),
      },
      {},
      OUTBOX,
    );
    await upload(application.id);

    await expect(
      payment.decideProof(
        db,
        staff,
        { paymentId: stale, decision: "APPROVED", idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      ),
    ).rejects.toBeInstanceOf(AlreadyHandledError);
  });

  it("refuses a decision on another family's proof as if it were not there", async () => {
    const application = await register();
    await upload(application.id);
    const paymentId = await waitingProofId(application.id);

    await expect(
      payment.decideProof(
        db,
        otherStaff,
        { paymentId, decision: "APPROVED", idempotencyKey: crypto.randomUUID() },
        {},
        OUTBOX,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
