import {
  COMMAND_PAYLOADS,
  PAYMENT_QUEUE_PAGE_SIZE,
  ProofFile,
  type BeginUploadInput,
  type DecideProofInput,
  type ListWaitingProofsInput,
  type PaymentPage,
  type ProofToReview,
  type SendProofInput,
  type SignedUpload,
  type WaitingProofPage,
} from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { isSchoolKey } from "@mbs/school-config";

import {
  AlreadyHandledError,
  ForbiddenError,
  IllegalTransitionError,
  NotFoundError,
} from "../../errors.ts";
import { findCycleById } from "../admission/repository.ts";
import { runCommand, type RequestMeta } from "../application/service.ts";
import { familyStage } from "../application/stages.ts";
import { appendAuditLog } from "../audit.ts";
import type { StaffContext } from "../auth/authorization.ts";
import { KEY_PREFIXES, proofProblem, type Files } from "../files/service.ts";
import type { OutboxSettings } from "../notification/outbox.ts";
import {
  countAttemptsUpTo,
  findNewestPayment,
  findPaymentForStaff,
  insertPayment,
  insertReview,
  listAttempts,
  listWaitingProofs,
  lockPaymentForReview,
  loadApplicationForPayment,
} from "./repository.ts";

const PURPOSE = "REGISTRATION";

export async function loadPaymentPage(
  db: Database,
  files: Files,
  family: { userId: string },
  applicationId: string,
): Promise<PaymentPage> {
  const application = await mine(db, applicationId, family.userId);
  const [cycle, attempts] = await Promise.all([
    findCycleById(db, application.admissionCycleId),
    listAttempts(db, application.id),
  ]);
  const account =
    cycle?.bankName && cycle.bankAccountNumber && cycle.bankAccountHolder
      ? {
          bankName: cycle.bankName,
          accountNumber: cycle.bankAccountNumber,
          accountHolder: cycle.bankAccountHolder,
        }
      : null;

  return {
    applicationId: application.id,
    childName: application.childName,
    registrationNumber: application.registrationNumber,
    schoolKey: schoolKeyOf(application),
    stage: familyStage(application.stage),
    amountDue: application.registrationFee,
    account,
    attempts: await Promise.all(
      attempts.toReversed().map(async (attempt) => ({
        id: attempt.id,
        sentAt: attempt.sentAt.toISOString(),
        file: ProofFile.parse({ contentType: attempt.contentType, byteSize: attempt.byteSize }),
        url: await files.signDownload(attempt),
        decision: attempt.decision,
        reason: attempt.reason,
      })),
    ),
  };
}

export async function beginProofUpload(
  db: Database,
  files: Files,
  family: { userId: string },
  input: BeginUploadInput,
): Promise<SignedUpload> {
  const application = await mine(db, input.applicationId, family.userId);
  if (application.stage !== "PAYMENT_DUE") {
    throw new AlreadyHandledError("This application is not waiting for a payment.");
  }
  const problem = proofProblem(input);
  if (problem) throw new ForbiddenError(`A receipt is refused for its ${problem.toLowerCase()}.`);

  return files.beginUpload({
    prefix: KEY_PREFIXES.PAYMENT_PROOF,
    applicationId: application.id,
    userId: family.userId,
    contentType: input.contentType,
    byteSize: input.byteSize,
    sha256: input.sha256,
  });
}

export async function sendProof(
  db: Database,
  files: Files,
  family: { userId: string },
  input: SendProofInput,
  meta: RequestMeta,
  outbox: OutboxSettings,
) {
  await runCommand(
    db,
    {
      applicationId: input.applicationId,
      actor: { type: "FAMILY", userId: family.userId },
      expectedSeq: null,
      idempotencyKey: input.idempotencyKey,
      meta,
    },
    "UPLOAD_PAYMENT_PROOF",
    outbox,
    {
      isRetry: async (earlier) => earlier.command === "UPLOAD_PAYMENT_PROOF",
      write: async (tx, application) => {
        const file = await files.completeUpload(tx, {
          token: input.token,
          applicationId: application.id,
          userId: family.userId,
        });
        await insertPayment(tx, {
          applicationId: application.id,
          purpose: PURPOSE,
          amountDue: application.registrationFee,
          method: "BANK_TRANSFER",
          fileId: file.id,
          createdByUserId: family.userId,
        });
        return COMMAND_PAYLOADS.UPLOAD_PAYMENT_PROOF.parse({ payloadVersion: 1 });
      },
    },
  );
}

export async function listProofQueue(
  db: Database,
  staff: StaffContext,
  input: ListWaitingProofsInput,
): Promise<WaitingProofPage> {
  const { rows, total } = await listWaitingProofs(db, staff.schoolKeys, input.page);
  return {
    rows: rows.map((row) => ({
      paymentId: row.paymentId,
      applicationId: row.applicationId,
      childName: row.childName,
      registrationNumber: row.registrationNumber,
      schoolKey: schoolKeyOf(row),
      amountDue: row.amountDue,
      sentAt: row.sentAt.toISOString(),
      attempt: row.attempt,
    })),
    total,
    page: input.page,
    pageSize: PAYMENT_QUEUE_PAGE_SIZE,
  };
}

export async function openProof(
  db: Database,
  files: Files,
  staff: StaffContext,
  paymentId: string,
  meta: RequestMeta,
): Promise<ProofToReview> {
  const found = await db.transaction(async (tx) => {
    const row = await findPaymentForStaff(tx, paymentId, staff.schoolKeys);
    if (!row) throw new NotFoundError("No such payment.");
    const attempt = await countAttemptsUpTo(tx, row.payment);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: staff.id,
      action: "file.viewed",
      entityType: "application",
      entityId: row.payment.applicationId,
      metadata: { paymentId: row.payment.id, fileId: row.payment.fileId },
      ...meta,
    });
    return { row, attempt };
  });

  const { row, attempt } = found;
  return {
    paymentId: row.payment.id,
    applicationId: row.payment.applicationId,
    childName: row.childName,
    registrationNumber: row.registrationNumber,
    schoolKey: schoolKeyOf(row),
    guardianName: row.guardianName,
    amountDue: row.payment.amountDue,
    sentAt: row.payment.createdAt.toISOString(),
    attempt,
    file: ProofFile.parse(row.file),
    url: await files.signDownload(row.file),
    urlExpiresInSeconds: files.downloadUrlSeconds,
    canDecide: staff.role !== "PRINCIPAL" && !row.decided,
  };
}

export async function decideProof(
  db: Database,
  staff: StaffContext,
  input: DecideProofInput,
  meta: RequestMeta,
  outbox: OutboxSettings,
) {
  const found = await findPaymentForStaff(db, input.paymentId, staff.schoolKeys);
  if (!found) throw new NotFoundError("No such payment.");

  const command = input.decision === "APPROVED" ? "APPROVE_PAYMENT" : "REJECT_PAYMENT";
  const payload = COMMAND_PAYLOADS[command].parse({
    payloadVersion: 1,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });

  try {
    await runCommand(
      db,
      {
        applicationId: found.payment.applicationId,
        actor: { type: "STAFF", staff },
        expectedSeq: null,
        idempotencyKey: input.idempotencyKey,
        meta,
      },
      command,
      outbox,
      {
        isRetry: async (earlier) => earlier.command === command,
        write: async (tx) => {
          const locked = await lockPaymentForReview(tx, input.paymentId);
          if (!locked || locked.decided) {
            throw new AlreadyHandledError("This proof was already decided.");
          }
          const newest = await findNewestPayment(tx, locked.payment.applicationId);
          if (newest?.id !== input.paymentId) {
            throw new AlreadyHandledError("A newer proof replaced this one.");
          }
          await insertReview(tx, {
            paymentId: input.paymentId,
            decision: input.decision,
            reason: input.decision === "REJECTED" ? (input.reason ?? null) : null,
            reviewedByStaffId: staff.id,
          });
          return payload;
        },
      },
    );
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new AlreadyHandledError("This proof was already decided.");
    }
    throw error;
  }
}

async function mine(db: Database, applicationId: string, userId: string) {
  const found = await loadApplicationForPayment(db, applicationId, userId);
  if (!found) throw new NotFoundError("No such application.");
  return found;
}

function schoolKeyOf({ schoolKey }: { schoolKey: string }) {
  if (!isSchoolKey(schoolKey)) throw new Error(`Unknown school ${schoolKey}.`);
  return schoolKey;
}
