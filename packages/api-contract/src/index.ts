import { oc } from "@orpc/contract";
import { z } from "zod";

import {
  FamilyApplication,
  FamilyApplicationSummary,
  ReusedKey,
  SubmitApplicationInput,
  SubmittedApplication,
} from "./application.ts";
import {
  AdmissionCycle,
  CreateCycleInput,
  CreateStaffInput,
  CycleRef,
  PublicAdmissionCycle,
  SchoolAdmissionSetting,
  SchoolKey,
  SetCycleStatusInput,
  SetStaffActiveInput,
  StaffProfile,
  StaffSummary,
  UpdateCycleInput,
  UpdateStaffInput,
  UpsertSchoolSettingInput,
} from "./schemas.ts";

export * from "./application.ts";
export * from "./schemas.ts";

/**
 * The public contract, organised by audience: `public`, `applicant`, `staff`
 * and `admin`.
 *
 * Anything under `applicant` needs a family session, which only the parent
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
          IDEMPOTENCY_KEY_REUSED: { status: 409, data: ReusedKey },
        }),
    },
  },
  staff: {
    me: {
      get: oc.output(StaffProfile),
    },
  },
  admin: {
    cycles: {
      list: oc.output(z.array(AdmissionCycle)),
      create: oc.input(CreateCycleInput).output(AdmissionCycle),
      update: oc.input(UpdateCycleInput).output(AdmissionCycle),
      setStatus: oc.input(SetCycleStatusInput).output(AdmissionCycle),
    },
    schoolSettings: {
      list: oc.input(CycleRef).output(z.array(SchoolAdmissionSetting)),
      upsert: oc.input(UpsertSchoolSettingInput).output(SchoolAdmissionSetting),
    },
    staff: {
      list: oc.output(z.array(StaffSummary)),
      create: oc.input(CreateStaffInput).output(StaffSummary),
      update: oc.input(UpdateStaffInput).output(StaffSummary),
      setActive: oc.input(SetStaffActiveInput).output(StaffSummary),
    },
  },
};
