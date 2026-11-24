import { ORPCError, safe } from "@mbs/api-client/rpc";
import { CHILDREN_PER_ACCOUNT, isSchoolKey } from "@mbs/school-config";

import { api } from "./api.ts";
import type { SchoolCycle } from "./cycles.ts";
import { setAttempt, type Draft } from "./draft.ts";
import { schoolName } from "./format.ts";
import { toProfile } from "./registration.ts";

/**
 * `created` is this form. `earlier` is what the same key made before the form was
 * edited, when its answer never arrived: then the edits were not sent.
 */
export type Outcome = {
  applicationId: string;
  result: "created" | "earlier" | "earlierOther";
};

/** Registration closed, or the school or the cycle is gone. */
export class ClosedError extends Error {
  override name = "ClosedError";
}

export async function sendDraft(draft: Draft, schools: readonly SchoolCycle[]): Promise<Outcome> {
  const { schoolKey } = draft.values;
  if (!isSchoolKey(schoolKey)) throw new Error("No school was chosen.");

  // A form that may already have arrived is sent again as it was, cycle included.
  const unanswered = draft.attempt?.schoolKey === schoolKey ? draft.attempt.cycleId : null;
  const cycleId =
    unanswered ?? schools.find((school) => school.schoolKey === schoolKey)?.cycle?.id ?? null;
  if (cycleId === null) throw new ClosedError();

  setAttempt(draft.userId, { cycleId, schoolKey });
  const { error, data, isDefined } = await safe(
    api.applicant.applications.submit({
      cycleId,
      schoolKey,
      profile: toProfile(draft.values),
      idempotencyKey: draft.key,
    }),
  );
  if (!error) return { applicationId: data.applicationId, result: "created" };

  if (isDefined && error.code === "IDEMPOTENCY_KEY_REUSED") {
    const { applicationId, sameRegistration } = error.data;
    return { applicationId, result: sameRegistration ? "earlier" : "earlierOther" };
  }
  if (isDefined) {
    // The server looks for the key before either of these, so nothing was made with it.
    setAttempt(draft.userId, null);
  } else if (error instanceof ORPCError && error.status < 500) {
    // This try made nothing, but the refusal came before the key was looked for, so
    // an earlier try is as uncertain as it was.
    setAttempt(draft.userId, draft.attempt);
  }
  if (isDefined && error.code === "REGISTRATION_CLOSED") throw new ClosedError();
  if (error instanceof ORPCError && error.code === "NOT_FOUND") throw new ClosedError();
  throw error;
}

export type SubmitFailure = { message: string; wayOut: boolean };

export function explainSubmit(error: Error, draft: Draft): SubmitFailure {
  const { schoolKey } = draft.values;
  const school = isSchoolKey(schoolKey) ? schoolName(schoolKey) : "sekolah ini";
  if (error instanceof ClosedError) {
    return {
      message: `Pendaftaran di ${school} sudah ditutup, jadi isian ini tidak terkirim.`,
      wayOut: true,
    };
  }
  if (error instanceof ORPCError) {
    if (error.code === "DUPLICATE_APPLICATION") {
      return {
        message: `NIK ini sudah terdaftar di ${school}. Periksa lagi NIK-nya. Kalau anak ini sudah kamu daftarkan, buka statusnya di halaman utama. Kalau belum, hubungi panitia.`,
        wayOut: true,
      };
    }
    if (error.code === "TOO_MANY_CHILDREN") {
      return {
        message: `Satu akun bisa mendaftarkan paling banyak ${CHILDREN_PER_ACCOUNT} anak, dan akun ini sudah mencapainya. Kalau perlu mendaftarkan lebih banyak, hubungi panitia.`,
        wayOut: true,
      };
    }
    const issues = issueMessages(error.data);
    if (error.code === "BAD_REQUEST" && issues.length > 0) {
      return { message: issues.join(" "), wayOut: false };
    }
    if (error.code === "UNAUTHORIZED") {
      return { message: "Kamu perlu masuk lagi sebelum mengirim.", wayOut: false };
    }
  }
  return {
    message:
      "Belum ada jawaban dari server, jadi belum pasti terkirim. Periksa koneksi internet kamu, lalu kirim lagi. Pendaftaran tidak akan tercatat dua kali.",
    wayOut: false,
  };
}

/** The rules' own messages, for a form that stopped being right on its way here. */
function issueMessages(data: unknown): string[] {
  if (typeof data !== "object" || data === null || !("issues" in data)) return [];
  if (!Array.isArray(data.issues)) return [];
  return data.issues.flatMap((issue: unknown) =>
    typeof issue === "object" && issue !== null && "message" in issue
      ? [String(issue.message)]
      : [],
  );
}
