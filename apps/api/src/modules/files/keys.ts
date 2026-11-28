import { randomUUID } from "node:crypto";

/**
 * Where one kind of object lives in the bucket. The prefix is the only part a
 * person could read, and it says nothing about whose file it is.
 */
export const KEY_PREFIXES = { PAYMENT_PROOF: "payment-proofs" } as const;
export type KeyPrefix = (typeof KEY_PREFIXES)[keyof typeof KEY_PREFIXES];

/**
 * A key travels in signed URLs, bucket listings and anyone's browser history,
 * so it carries no name, NIK, registration number or account id. It is random
 * and nothing else, and the `files` row is what ties it to a person.
 */
export function newObjectKey(prefix: KeyPrefix) {
  return `${prefix}/${randomUUID()}`;
}
