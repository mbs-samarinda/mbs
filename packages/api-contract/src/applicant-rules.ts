/**
 * The registration form's rules and messages, once, for both sides. The contract
 * builds its Zod schema from them and the parent app runs them as they are, so
 * the browser loads no Zod. Nothing here may import it.
 */
import { GUARDIAN_RELATIONS, SEXES } from "@mbs/school-config";

export type RuleResult<T> = { ok: true; value: T } | { ok: false; message: string };
export type Rule<T> = (raw: string, now: Date) => RuleResult<T>;

/** Zero-width and direction marks. Contact apps put them around a number that is copied. */
const INVISIBLE = /[\u200b\u200e\u200f\u2060\u202a-\u202e\u2066-\u2069\ufeff]/g;
const NAME_MAX = 200;
const AGE = { min: 8, max: 25 };

export const APPLICANT_RULES = {
  childFullName: name("nama lengkap anak"),
  nik: (raw) => {
    const digits = raw.replaceAll(INVISIBLE, "").replaceAll(/[\s.]/g, "");
    if (digits === "") return refuse("Isi NIK anak, 16 angka di kartu keluarga.");
    if (/\D/.test(digits)) return refuse("NIK anak hanya berisi angka. Periksa lagi NIK-nya.");
    if (digits.length !== 16) {
      return refuse(`NIK anak harus 16 angka. Yang tertulis ${digits.length} angka.`);
    }
    return accept(digits);
  },
  birthDate: (raw, now) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return refuse("Isi tanggal, bulan, dan tahun lahir anak. Tahunnya 4 angka.");
    }
    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      return refuse("Tanggal lahir anak tidak ada di kalender. Periksa lagi tanggalnya.");
    }
    const today = dateInSamarinda(now);
    if (raw > yearsBefore(today, AGE.min) || raw <= yearsBefore(today, AGE.max + 1)) {
      return refuse(
        `Umur anak harus ${AGE.min} sampai ${AGE.max} tahun. Periksa lagi tahun lahirnya.`,
      );
    }
    return accept(raw);
  },
  sex: oneOf(SEXES, "Pilih jenis kelamin anak."),
  schoolOfOrigin: name("asal sekolah anak"),
  guardianName: name("nama lengkap orang tua/wali"),
  guardianRelation: oneOf(GUARDIAN_RELATIONS, "Pilih hubungan kamu dengan anak."),
  guardianPhone: (raw) => {
    if (raw.trim() === "") return refuse("Isi nomor HP orang tua/wali.");
    const phone = toE164(raw);
    return phone
      ? accept(phone)
      : refuse("Tulis nomor HP lengkap, misalnya 0812 3456 7890 atau +60 12 345 6789.");
  },
} satisfies Record<string, Rule<string>>;

export type ApplicantField = keyof typeof APPLICANT_RULES;

function accept<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

function refuse(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** Any script and any length of word, because names are not ours to judge. */
function name(label: string): Rule<string> {
  return (raw) => {
    const value = cleanLine(raw);
    if (value === "") return refuse(`Isi ${label}.`);
    if (value.length > NAME_MAX) {
      return refuse(`Singkatkan ${label}, paling banyak ${NAME_MAX} huruf.`);
    }
    return accept(value);
  };
}

/**
 * One line of text. Control characters and half a surrogate pair fail in
 * Postgres JSON as a 500, and direction overrides can make a name show as
 * another one, so they are dropped here.
 */
function cleanLine(raw: string) {
  return raw
    .replaceAll(/[\p{Cc}\p{Cs}\u2028\u2029]/gu, " ")
    .replaceAll(INVISIBLE, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function oneOf<const T extends string>(list: readonly T[], message: string): Rule<T> {
  return (raw) => {
    const value = list.find((item) => item === raw);
    return value === undefined ? refuse(message) : accept(value);
  };
}

const PUNCTUATION = /[\s.()\-\u2010-\u2015]/g;

/** `0812…`, `62812…` and `+62…` are Indonesian. Any other country needs its `+`. */
function toE164(raw: string) {
  const compact = raw.replaceAll(INVISIBLE, "").replaceAll(PUNCTUATION, "").replace(/^00/, "+");
  if (!/^\+?\d+$/.test(compact)) return null;
  if (compact.startsWith("+") && !compact.startsWith("+62")) {
    return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
  }
  // The 0 that a number starts with at home is often kept after +62.
  const national = compact.replace(/^(\+?62)?0?/, "");
  const hasPrefix = national.length < compact.length;
  return hasPrefix && /^[2-9]\d{7,11}$/.test(national) ? `+62${national}` : null;
}

/** WITA is UTC+8 and has no summer time, and the schools are in Samarinda. */
function dateInSamarinda(now: Date) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yearsBefore(date: string, years: number) {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}
