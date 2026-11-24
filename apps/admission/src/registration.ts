import type { Account } from "@mbs/api-client/auth";
import { serverNow } from "@mbs/api-client/http";
import type { ApplicantProfileInput } from "@mbs/api-contract";
import { APPLICANT_RULES, type ApplicantField } from "@mbs/api-contract/applicant-rules";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { cyclesQuery, sortByPhase, type SchoolCycle } from "./cycles.ts";
import { draftOf, type Draft, type Values } from "./draft.ts";

export const STEPS = ["sekolah", "anak", "wali", "periksa"] as const;
export type Step = (typeof STEPS)[number];

export function isStep(value: string): value is Step {
  return STEPS.some((step) => step === value);
}

/** In the order they are on screen, so the first wrong one is the first to fix. */
export const STEP_FIELDS = {
  anak: ["childFullName", "nik", "birthDate", "sex", "schoolOfOrigin"],
  wali: ["guardianName", "guardianRelation", "guardianPhone"],
} as const satisfies Partial<Record<Step, readonly ApplicantField[]>>;

export function toProfile(values: Values): ApplicantProfileInput {
  const { birthDay, birthMonth, birthYear, childFullName, nik, sex, schoolOfOrigin } = values;
  const { guardianName, guardianRelation, guardianPhone } = values;
  return {
    childFullName,
    nik,
    // Parts left empty make no date, which the rule answers by asking for all three.
    birthDate: `${birthYear.trim()}-${birthMonth}-${birthDay.trim().padStart(2, "0")}`,
    sex,
    schoolOfOrigin,
    guardianName,
    guardianRelation,
    guardianPhone,
  };
}

export type FieldErrors = { [F in ApplicantField]?: string };

export function errorsIn(values: Values, fields: readonly ApplicantField[]): FieldErrors {
  const profile = toProfile(values);
  const errors: FieldErrors = {};
  for (const field of fields) {
    const result = APPLICANT_RULES[field](profile[field], serverNow());
    if (!result.ok) errors[field] = result.message;
  }
  return errors;
}

/** Where a visit to the form belongs. Home says why when there is no form to offer. */
export async function openForm(context: { queryClient: QueryClient; account: Account }) {
  // What is cached will do: the steps have to work offline, and the server
  // decides again at submit.
  const schools = await context.queryClient.ensureQueryData(cyclesQuery);
  const draft = draftOf(context.account.id);
  if (!draft?.attempt && sortByPhase(schools, serverNow()).open.length === 0) {
    throw redirect({ to: "/", replace: true });
  }
  return { draft, firstOpen: firstOpenStep(draft, schools) };
}

/** The first step that still needs something. */
function firstOpenStep(draft: Draft | null, schools: readonly SchoolCycle[]): Step {
  if (!draft || !canChoose(draft, schools)) return "sekolah";
  for (const step of ["anak", "wali"] as const) {
    if (Object.keys(errorsIn(draft.values, STEP_FIELDS[step])).length > 0) return step;
  }
  return "periksa";
}

/**
 * A form that may already have reached the server keeps its school after it
 * closes, because sending it again is how the family finds out.
 */
function canChoose({ values, attempt }: Draft, schools: readonly SchoolCycle[]) {
  const { open } = sortByPhase(schools, serverNow());
  return (
    open.some((school) => school.schoolKey === values.schoolKey) ||
    (attempt !== null && attempt.schoolKey === values.schoolKey)
  );
}
