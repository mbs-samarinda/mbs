import { randomUUID } from "node:crypto";

export const KEY_PREFIXES = { PAYMENT_PROOF: "payment-proofs" } as const;
export type KeyPrefix = (typeof KEY_PREFIXES)[keyof typeof KEY_PREFIXES];

export function newObjectKey(prefix: KeyPrefix) {
  return `${prefix}/${randomUUID()}`;
}
