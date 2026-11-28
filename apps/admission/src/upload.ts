import type { ProofFile } from "@mbs/api-contract";
import { PROOF_CONTENT_TYPES, PROOF_MAX_BYTES } from "@mbs/school-config";

/**
 * How a receipt leaves the browser. Bytes go straight to the bucket, so a slow
 * phone upload never holds an API connection open.
 */

/** About this big after shrinking: readable on a desk, small on a phone plan. */
const TARGET_BYTES = 500_000;
/** A receipt is read, not printed. Beyond this the extra pixels say nothing. */
const MAX_EDGE = 1600;

export type ChosenFile = {
  blob: Blob;
  contentType: ProofFile["contentType"];
  byteSize: number;
  sha256: string;
};

export const TOO_BIG = "TOO_BIG";
export const BAD_TYPE = "BAD_TYPE";

/**
 * Shrinks a photo and hashes what will actually be sent. A PDF travels as it
 * is: it is already small, and re-encoding it would lose the text.
 *
 * A HEIC from an iPhone is left alone too, because Chrome cannot decode it.
 * That is why the cap is 10 MB rather than 1 MB.
 */
export async function prepare(file: File): Promise<ChosenFile | typeof TOO_BIG | typeof BAD_TYPE> {
  const shrunk = (await shrink(file)) ?? file;
  const contentType = shrunk.type || file.type;
  if (!isProofType(contentType)) return BAD_TYPE;
  if (shrunk.size > PROOF_MAX_BYTES) return TOO_BIG;
  return { blob: shrunk, contentType, byteSize: shrunk.size, sha256: await hash(shrunk) };
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

/** Base64, which is what S3 wants in the checksum it signs. */
async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * Sends the bytes to the bucket. The headers are the ones the API signed, so
 * the bucket refuses anything else, including bytes that are not the ones that
 * were hashed.
 */
export async function putToBucket(url: string, file: ChosenFile) {
  const response = await fetch(url, {
    method: "PUT",
    body: file.blob,
    headers: {
      "content-type": file.contentType,
      "x-amz-checksum-sha256": file.sha256,
    },
  });
  if (!response.ok) throw new Error(`The bucket refused the upload (${response.status}).`);
}
