import { familyProcedure, staffProcedure } from "../../plugins/orpc.ts";
import {
  beginProofUpload,
  decideProof,
  listProofQueue,
  loadPaymentPage,
  openProof,
  sendProof,
} from "./service.ts";

export const getPaymentPageProcedure = familyProcedure.applicant.payments.get.handler(
  ({ input, context }) => loadPaymentPage(context.db, context.family, input.applicationId),
);

export const beginProofUploadProcedure = familyProcedure.applicant.payments.beginUpload.handler(
  ({ input, context }) => beginProofUpload(context.db, context.files, context.family, input),
);

export const sendProofProcedure = familyProcedure.applicant.payments.sendProof.handler(
  ({ input, context }) =>
    sendProof(context.db, context.files, context.family, input, context.meta, context.outbox),
);

export const listWaitingProofsProcedure = staffProcedure.staff.payments.listWaiting.handler(
  ({ input, context }) => listProofQueue(context.db, context.staff, input),
);

export const openProofProcedure = staffProcedure.staff.payments.get.handler(({ input, context }) =>
  openProof(context.db, context.files, context.staff, input.paymentId, context.meta),
);

export const decideProofProcedure = staffProcedure.staff.payments.decide.handler(
  ({ input, context }) =>
    decideProof(context.db, context.staff, input, context.meta, context.outbox),
);
