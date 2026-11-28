import { PAYMENT_DECISIONS, PROOF_CONTENT_TYPES } from "@mbs/school-config";
import { z } from "zod";

import { COMMAND_PAYLOADS, FamilyStage } from "./application.ts";
import { BankAccount, SchoolKey } from "./schemas.ts";

const At = z.iso.datetime();

export const PaymentDecision = z.enum(PAYMENT_DECISIONS);
export type PaymentDecision = z.infer<typeof PaymentDecision>;

/**
 * What was stored, never what the family typed. No file name: the browser's
 * name is the family's own text, and the screen has no use for it that the type
 * and size do not cover.
 */
export const ProofFile = z.object({
  contentType: z.enum(PROOF_CONTENT_TYPES),
  byteSize: z.int().positive(),
});
export type ProofFile = z.infer<typeof ProofFile>;

/** One attempt to pay. A rejected attempt keeps its reason forever. */
export const PaymentAttempt = z.object({
  id: z.uuid(),
  sentAt: At,
  file: ProofFile,
  /** Signed and short-lived, so the family can see what it sent. Its own file. */
  url: z.url(),
  decision: PaymentDecision.nullable(),
  /** Written by the committee for the family to read. Only on a rejection. */
  reason: z.string().nullable(),
});
export type PaymentAttempt = z.infer<typeof PaymentAttempt>;

export const PaymentPage = z.object({
  applicationId: z.uuid(),
  childName: z.string(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  stage: FamilyStage,
  /** Copied at registration, so a later fee change never moves it. */
  amountDue: z.int().nonnegative(),
  /** Null while an administrator has not filled the cycle's bank account in. */
  account: BankAccount.nullable(),
  /** Newest first. */
  attempts: z.array(PaymentAttempt),
});
export type PaymentPage = z.infer<typeof PaymentPage>;

export const BeginUploadInput = z.object({
  applicationId: z.uuid(),
  contentType: z.enum(PROOF_CONTENT_TYPES),
  byteSize: z.int().positive(),
  /** Base64 SHA-256 of the exact bytes the browser is about to send. */
  sha256: z.base64(),
});
export type BeginUploadInput = z.infer<typeof BeginUploadInput>;

export const SignedUpload = z.object({
  uploadUrl: z.url(),
  /** Handed back with the proof, so the API knows which upload it signed. */
  token: z.string(),
  expiresInSeconds: z.int().positive(),
});
export type SignedUpload = z.infer<typeof SignedUpload>;

export const SendProofInput = z.object({
  applicationId: z.uuid(),
  token: z.string(),
  /** Made once per chosen file, so a retry after a cut network sends one proof. */
  idempotencyKey: z.uuid(),
});
export type SendProofInput = z.infer<typeof SendProofInput>;

export const PAYMENT_QUEUE_PAGE_SIZE = 50;

export const ListWaitingProofsInput = z.object({ page: z.int().min(1) });
export type ListWaitingProofsInput = z.infer<typeof ListWaitingProofsInput>;

/** One line in the committee's queue. Enough to choose, never enough to decide. */
export const WaitingProof = z.object({
  paymentId: z.uuid(),
  applicationId: z.uuid(),
  childName: z.string(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  amountDue: z.int().nonnegative(),
  sentAt: At,
  /** 1 for a first proof, higher after a rejection. */
  attempt: z.int().min(1),
});
export type WaitingProof = z.infer<typeof WaitingProof>;

export const WaitingProofPage = z.object({
  rows: z.array(WaitingProof),
  total: z.int().nonnegative(),
  page: z.int().min(1),
  pageSize: z.literal(PAYMENT_QUEUE_PAGE_SIZE),
});
export type WaitingProofPage = z.infer<typeof WaitingProofPage>;

export const PaymentRef = z.object({ paymentId: z.uuid() });
export type PaymentRef = z.infer<typeof PaymentRef>;

/**
 * One proof, open on the desk. Asking for it is what records that this staff
 * member looked at a family's file, so nothing preloads it.
 */
export const ProofToReview = z.object({
  paymentId: z.uuid(),
  applicationId: z.uuid(),
  childName: z.string(),
  registrationNumber: z.string(),
  schoolKey: SchoolKey,
  guardianName: z.string(),
  amountDue: z.int().nonnegative(),
  sentAt: At,
  attempt: z.int().min(1),
  file: ProofFile,
  /** Signed, short-lived, and never put in a link anyone can share. */
  url: z.url(),
  /** False for a principal, who reads and decides nothing. */
  canDecide: z.boolean(),
});
export type ProofToReview = z.infer<typeof ProofToReview>;

export const DecideProofInput = PaymentRef.extend({
  decision: PaymentDecision,
  /** Required on a rejection, because the family reads it. */
  reason: COMMAND_PAYLOADS.REJECT_PAYMENT.shape.reason.optional(),
  idempotencyKey: z.uuid(),
}).refine((input) => (input.decision === "REJECTED") === (input.reason !== undefined), {
  message: "A rejection needs a reason, and an approval takes none.",
  path: ["reason"],
});
export type DecideProofInput = z.infer<typeof DecideProofInput>;
