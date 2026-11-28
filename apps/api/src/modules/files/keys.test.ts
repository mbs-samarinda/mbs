import { describe, expect, it } from "vitest";

import { KEY_PREFIXES, newObjectKey } from "./keys.ts";

const SECRETS = {
  childName: "Aisyah Nur Rahmadani",
  nik: "6472010101100001",
  registrationNumber: "SMP-2026-0042",
  userId: "ySxQ4m0Qk5s2bWgJ7hTcPz",
  applicationId: "9f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
};

describe("an object key", () => {
  it("never carries a name, NIK, registration number or account id", () => {
    const keys = Array.from({ length: 200 }, () => newObjectKey(KEY_PREFIXES.PAYMENT_PROOF));

    for (const key of keys) {
      for (const secret of Object.values(SECRETS)) {
        expect(key).not.toContain(secret);
        expect(key).not.toContain(secret.toLowerCase());
        // A key built from a NIK or a number would keep its digits even if the
        // separators were dropped.
        expect(key.replaceAll(/\W/g, "")).not.toContain(secret.replaceAll(/\W/g, ""));
      }
    }
  });

  it("is a new random key every time, under its prefix", () => {
    const keys = Array.from({ length: 200 }, () => newObjectKey(KEY_PREFIXES.PAYMENT_PROOF));

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(
        /^payment-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });
});
