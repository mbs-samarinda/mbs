import { oc } from "@orpc/contract";
import { z } from "zod";

import {
  CheckedStatus,
  CheckStatusInput,
  FamilyApplication,
  FamilyApplicationSummary,
  ReusedKey,
  SubmitApplicationInput,
  SubmittedApplication,
  TooManyTries,
} from "./application.ts";
import {
  AddedNote,
  AddNoteInput,
  ApplicationRef,
  CommitteeApplication,
  CommitteeApplicationPage,
  CommitteeDashboard,
  ListApplicationsInput,
} from "./committee.ts";
import {
  AgreementVersion,
  AgreementVersionsInput,
  CycleSetup,
  NotReady,
  SaveCycleInput,
} from "./cycle-setup.ts";
import {
  BeginUploadInput,
  DecideProofInput,
  ListWaitingProofsInput,
  PaymentPage,
  PaymentRef,
  ProofToReview,
  SendProofInput,
  SignedUpload,
  WaitingProofPage,
} from "./payment.ts";
import {
  AdmissionCycle,
  CreateCycleInput,
  CreateStaffInput,
  CycleRef,
  EmailTaken,
  PublicAdmissionCycle,
  SchoolKey,
  SetCycleStatusInput,
  SetStaffActiveInput,
  StaffProfile,
  StaffSummary,
  UpdateStaffInput,
} from "./schemas.ts";

export * from "./application.ts";
export * from "./committee.ts";
export * from "./cycle-setup.ts";
export * from "./payment.ts";
export * from "./schemas.ts";

/**
 * The public contract, organised by audience: `public`, `applicant`, `staff`
 * and `admin`.
 *
 * `public.application` exists only on the parent app's host. Anything under
 * `applicant` needs a family session, which only the parent
 * app's host gives. Anything under `staff` needs an active staff session from
 * the committee app's host; anything under `admin` needs the ADMINISTRATOR
 * role on top. An application the family cannot see is NOT_FOUND. Failures
 * arrive as oRPC codes: UNAUTHORIZED, FORBIDDEN, NOT_FOUND and CONFLICT, plus
 * the codes a procedure declares with `errors`.
 */
export const contract = {
  public: {
    admission: {
      getCurrentCycle: oc
        .input(z.object({ schoolKey: SchoolKey }))
        .output(PublicAdmissionCycle.nullable()),
    },
    application: {
      /** NO_MATCH is the one answer to every miss, so it never says which part was wrong. */
      checkStatus: oc
        .input(CheckStatusInput)
        .output(CheckedStatus)
        .errors({
          NO_MATCH: { status: 404 },
          TOO_MANY_TRIES: { status: 429, data: TooManyTries },
        }),
    },
  },
  applicant: {
    applications: {
      list: oc.output(z.array(FamilyApplicationSummary)),
      get: oc.input(z.object({ applicationId: z.uuid() })).output(FamilyApplication),
      submit: oc
        .input(SubmitApplicationInput)
        .output(SubmittedApplication)
        .errors({
          REGISTRATION_CLOSED: { status: 409 },
          DUPLICATE_APPLICATION: { status: 409 },
          TOO_MANY_CHILDREN: { status: 409 },
          IDEMPOTENCY_KEY_REUSED: { status: 409, data: ReusedKey },
        }),
    },
    payments: {
      get: oc.input(z.object({ applicationId: z.uuid() })).output(PaymentPage),
      beginUpload: oc.input(BeginUploadInput).output(SignedUpload),
      sendProof: oc
        .input(SendProofInput)
        .output(z.void())
        .errors({ UPLOAD_INCOMPLETE: { status: 409 }, CONFLICT: { status: 409 } }),
    },
  },
  staff: {
    me: {
      get: oc.output(StaffProfile),
    },
    dashboard: {
      get: oc.output(CommitteeDashboard),
    },
    /**
     * Reads answer NOT_FOUND for an application outside the caller's schools, as
     * for one that does not exist. Only `addNote` can be FORBIDDEN: a principal
     * reads but does not write.
     */
    applications: {
      list: oc.input(ListApplicationsInput).output(CommitteeApplicationPage),
      /** Writes nothing, because the app preloads it on hover. */
      get: oc.input(ApplicationRef).output(CommitteeApplication),
      /** Once per visit to an application's page. */
      recordView: oc.input(ApplicationRef).output(z.void()),
      addNote: oc.input(AddNoteInput).output(AddedNote),
    },
    payments: {
      listWaiting: oc.input(ListWaitingProofsInput).output(WaitingProofPage),
      open: oc.input(PaymentRef).output(ProofToReview),
      decide: oc
        .input(DecideProofInput)
        .output(z.void())
        .errors({ ALREADY_HANDLED: { status: 409 }, CONFLICT: { status: 409 } }),
    },
  },
  admin: {
    cycles: {
      /** Newest registration window first. */
      list: oc.output(z.array(AdmissionCycle)),
      get: oc.input(CycleRef).output(CycleSetup),
      /** A draft that copies the bank, fees, documents and messages of the newest cycle. */
      create: oc.input(CreateCycleInput).output(AdmissionCycle),
      save: oc.input(SaveCycleInput).output(CycleSetup),
      /** OPEN is refused until every gap that blocks opening is filled. */
      setStatus: oc
        .input(SetCycleStatusInput)
        .output(AdmissionCycle)
        .errors({
          NOT_READY: { status: 409, data: NotReady },
          ANOTHER_CYCLE_OPEN: { status: 409 },
        }),
    },
    agreements: {
      /** Every version of one school's agreement, newest first. */
      list: oc.input(AgreementVersionsInput).output(z.array(AgreementVersion)),
    },
    staff: {
      list: oc.output(z.array(StaffSummary)),
      create: oc
        .input(CreateStaffInput)
        .output(StaffSummary)
        .errors({ EMAIL_TAKEN: { status: 409, data: EmailTaken } }),
      update: oc
        .input(UpdateStaffInput)
        .output(StaffSummary)
        .errors({
          EMAIL_TAKEN: { status: 409, data: EmailTaken },
          LAST_ADMINISTRATOR: { status: 409 },
        }),
      setActive: oc
        .input(SetStaffActiveInput)
        .output(StaffSummary)
        .errors({ LAST_ADMINISTRATOR: { status: 409 } }),
    },
  },
};
