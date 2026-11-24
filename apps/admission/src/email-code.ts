import { accountIn, AuthError, authPost, type Account } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";

export const CODE_LENGTH = 6;

export async function requestCode(email: string) {
  await authPost("/email-otp/send-verification-otp", { email, type: "sign-in" });
}

/** Null when the sign-in worked but its answer was cut off on the way. */
export async function signInWithCode(email: string, otp: string): Promise<Account | null> {
  return accountIn(await authPost("/sign-in/email-otp", { email, otp }));
}

/**
 * The address the last code went to. It has to survive a refresh of the code
 * step, and it is personal data, so it stays out of the URL.
 */
const PENDING_EMAIL_KEY = "mbs:code-email";

export function pendingEmail(): string | null {
  return sessionStorage.getItem(PENDING_EMAIL_KEY);
}

export function setPendingEmail(email: string | null) {
  if (email === null) sessionStorage.removeItem(PENDING_EMAIL_KEY);
  else sessionStorage.setItem(PENDING_EMAIL_KEY, email);
}

export type Failure = {
  message: string;
  /** What can still work: the same thing again, the last code sent, or neither. */
  next: "RETRY" | "LAST_CODE" | null;
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
    if (refusal) return { message: refusal, next: null };
    if (error.status === 429) {
      return retryable(`Terlalu banyak percobaan. Tunggu ${waitOf(error)}, lalu coba lagi.`);
    }
  }
  return retryable("Ada gangguan di sistem kami. Coba lagi sebentar lagi.");
}

function retryable(message: string): Failure {
  return { message, next: "RETRY" };
}

function tooManyCodes(error: AuthError): Failure {
  const { body } = error;
  const lastCodeWorks =
    typeof body === "object" &&
    body !== null &&
    "lastCodeWorks" in body &&
    body.lastCodeWorks === true;
  return {
    message: lastCodeWorks
      ? `Kami sudah mengirim 5 kode ke email ini. Pakai kode yang terakhir, atau minta kode baru ${waitOf(error)} lagi.`
      : `Kami sudah mengirim 5 kode ke email ini. Minta kode baru ${waitOf(error)} lagi.`,
    next: lastCodeWorks ? "LAST_CODE" : null,
  };
}

function waitOf({ retryAfterSeconds }: AuthError) {
  if (retryAfterSeconds === null) return "1 menit";
  return retryAfterSeconds < 60
    ? `${retryAfterSeconds} detik`
    : `${Math.ceil(retryAfterSeconds / 60)} menit`;
}
