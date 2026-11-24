import { INVISIBLE } from "@mbs/api-contract/applicant-rules";
import { SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";

const SEPARATORS = String.raw`[\s\-‐-―−]*`;
// Six digits is far above any real sequence and far below a NIK, so a NIK typed
// in this field never reads as a number and is never stored.
const TYPED = new RegExp(`^(${SCHOOL_KEYS.join("|")})${SEPARATORS}0*([1-9]\\d{0,5})$`, "i");

export function formatRegistrationNumber(schoolKey: SchoolKey, seq: number) {
  return `${schoolKey.toUpperCase()}-${String(seq).padStart(4, "0")}`;
}

/** The number as it is stored, however a person typed it, or null if it cannot be one. */
export function parseRegistrationNumber(typed: string) {
  const [, school, seq] = TYPED.exec(typed.replaceAll(INVISIBLE, "").trim()) ?? [];
  const schoolKey = SCHOOL_KEYS.find((key) => key === school?.toLowerCase());
  return schoolKey ? formatRegistrationNumber(schoolKey, Number(seq)) : null;
}
