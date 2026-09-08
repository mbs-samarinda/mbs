import { oc } from "@orpc/contract";
import { z } from "zod";

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

export * from "./schemas.ts";

/**
 * The public contract, organised by audience. `applicant`, `staff` and `admin`
 * are the agreed namespaces and get added when they carry procedures.
 *
 * Anything under `staff` needs an active staff session; anything under `admin`
 * needs the ADMINISTRATOR role on top. Failures arrive as oRPC codes:
 * UNAUTHORIZED, FORBIDDEN, NOT_FOUND and CONFLICT.
 */
export const contract = {
  public: {
    admission: {
      getCurrentCycle: oc
        .input(z.object({ schoolKey: SchoolKey }))
        .output(PublicAdmissionCycle.nullable()),
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
