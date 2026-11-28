import type { ProofFile } from "@mbs/api-contract";
import { PROOF_CONTENT_TYPES, PROOF_MAX_BYTES } from "@mbs/school-config";

const TARGET_BYTES = 500_000;
const MAX_EDGE = 1600;

export type ChosenFile = {
  blob: Blob;
  contentType: ProofFile["contentType"];
  byteSize: number;
  sha256: string;
};

export const TOO_BIG = "TOO_BIG";
export const BAD_TYPE = "BAD_TYPE";

export async function prepare(file: File): Promise<ChosenFile | typeof TOO_BIG | typeof BAD_TYPE> {
  const shrunk = (await shrink(file)) ?? file;
  // Desktop Chrome hands over a .heic with no type at all, so the name decides
  // when the browser will not.
  const contentType = shrunk.type || file.type || typeFromName(file.name);
  if (!isProofType(contentType)) return BAD_TYPE;
  if (shrunk.size > PROOF_MAX_BYTES) return TOO_BIG;
  return { blob: shrunk, contentType, byteSize: shrunk.size, sha256: await hash(shrunk) };
}

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

function typeFromName(name: string) {
  return BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function isProofType(value: string): value is ProofFile["contentType"] {
  return (PROOF_CONTENT_TYPES as readonly string[]).includes(value);
}

async function shrink(file: File): Promise<Blob | null> {
  if (!file.type.startsWith("image/") || file.size <= TARGET_BYTES) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC, or anything else this browser will not decode. It goes as it is.
    return null;
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    // Shrinking a small or already-compressed photo can make it bigger.
    return jpeg.size < file.size ? jpeg : null;
  } finally {
    bitmap.close();
  }
}

async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * Sends the bytes to the bucket. Only the length and the host are signed into
 * the URL, so this sends no `x-amz-*` header: an unsigned one is refused by
 * some S3-compatible buckets and ignored by the rest.
 */
export async function putToBucket(url: string, file: ChosenFile) {
  const response = await fetch(url, {
    method: "PUT",
    body: file.blob,
    headers: { "content-type": file.contentType },
  });
  if (!response.ok) throw new Error(`The bucket refused the upload (${response.status}).`);
}
