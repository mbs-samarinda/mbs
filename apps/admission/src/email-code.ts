import { AuthError, authRequest } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";

export const CODE_LENGTH = 6;

export async function requestCode(email: string) {
  await authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" });
}

export async function signInWithCode(email: string, otp: string) {
  await authRequest("/sign-in/email-otp", { email, otp });
}

/**
 * The address the last code went to. It has to survive a refresh of the code
 * step, and it is personal data, so it stays out of the URL.
 */
const KEY = "mbs:code-email";

export function pendingEmail(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setPendingEmail(email: string | null) {
  if (email === null) sessionStorage.removeItem(KEY);
  else sessionStorage.setItem(KEY, email);
}

export type Failure = {
  message: string;
  /** Sending the same thing again can work. */
  canRetry: boolean;
  /** No more codes for now, but the last one may still work. */
  hasUsableCode: boolean;
};

const REFUSALS: Record<string, string> = {
  INVALID_EMAIL: "Tulis alamat email lengkap, misalnya nama@email.com.",
  INVALID_OTP: "Kode belum cocok. Periksa lagi kode di email terbaru, lalu coba lagi.",
  OTP_EXPIRED: "Kode ini sudah lewat 5 menit. Pilih Kirim kode baru.",
  TOO_MANY_ATTEMPTS: "Kode ini sudah 3 kali tidak cocok. Pilih Kirim kode baru.",
};

export function explain(error: Error): Failure {
  if (error instanceof UnreachableError) {
    return retryable("Server tidak bisa dihubungi. Periksa koneksi internet kamu.");
  }
  if (error instanceof AuthError) {
    if (error.code === "TOO_MANY_CODES") return tooManyCodes(error);
    const refusal = error.code === null ? undefined : REFUSALS[error.code];
    if (refusal) return { message: refusal, canRetry: false, hasUsableCode: false };
    if (error.status === 429) {
      return retryable(`Terlalu banyak percobaan. Tunggu ${waitOf(error)}, lalu coba lagi.`);
    }
  }
  return retryable("Ada gangguan di sistem kami. Coba lagi sebentar lagi.");
}

function retryable(message: string): Failure {
  return { message, canRetry: true, hasUsableCode: false };
}

/** The cap outlasts a code, so the last one is worth trying only for a while. */
function tooManyCodes(error: AuthError): Failure {
  const { details } = error;
  const hasUsableCode =
    typeof details === "object" &&
    details !== null &&
    "lastCodeInTime" in details &&
    details.lastCodeInTime === true;
  return {
    message: hasUsableCode
      ? `Kami sudah mengirim 5 kode ke email ini. Pakai kode yang terakhir, atau minta kode baru ${waitOf(error)} lagi.`
      : `Kami sudah mengirim 5 kode ke email ini. Minta kode baru ${waitOf(error)} lagi.`,
    canRetry: false,
    hasUsableCode,
  };
}

function waitOf({ retryAfterSeconds }: AuthError) {
  if (retryAfterSeconds === null) return "1 menit";
  return retryAfterSeconds < 60
    ? `${retryAfterSeconds} detik`
    : `${Math.ceil(retryAfterSeconds / 60)} menit`;
}
