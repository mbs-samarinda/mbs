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
  /** Too many codes were sent, and the last one still works. */
  hasUsableCode: boolean;
};

const REFUSALS: Record<string, string> = {
  INVALID_EMAIL: "Tulis alamat email lengkap, misalnya nama@email.com.",
  TOO_MANY_CODES:
    "Kami sudah mengirim 5 kode ke email ini. Pakai kode yang terakhir, atau minta kode baru 15 menit lagi.",
  INVALID_OTP: "Kode belum cocok. Periksa lagi kode di email terbaru, lalu coba lagi.",
  OTP_EXPIRED: "Kode ini sudah lewat 5 menit. Pilih Kirim kode baru.",
  TOO_MANY_ATTEMPTS: "Kode ini sudah 3 kali tidak cocok. Pilih Kirim kode baru.",
};

export function explain(error: Error): Failure {
  const failure = (message: string, canRetry: boolean) => ({
    message,
    canRetry,
    hasUsableCode: error instanceof AuthError && error.code === "TOO_MANY_CODES",
  });
  if (error instanceof UnreachableError) {
    return failure("Server tidak bisa dihubungi. Periksa koneksi internet kamu.", true);
  }
  if (error instanceof AuthError) {
    const refusal = error.code === null ? undefined : REFUSALS[error.code];
    if (refusal) return failure(refusal, false);
    if (error.status === 429) {
      const wait = error.retryAfterSeconds;
      return failure(
        `Terlalu banyak percobaan. Tunggu ${wait === null ? "1 menit" : `${wait} detik`}, lalu coba lagi.`,
        true,
      );
    }
  }
  return failure("Ada gangguan di sistem kami. Coba lagi sebentar lagi.", true);
}
