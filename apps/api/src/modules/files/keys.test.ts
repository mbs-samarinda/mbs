import { PROOF_CONTENT_TYPES, PROOF_MAX_BYTES } from "@mbs/school-config";
import { describe, expect, it } from "vitest";

import { KEY_PREFIXES, newObjectKey } from "./keys.ts";
import { proofProblem } from "./service.ts";

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

describe("a receipt", () => {
  const ok = { contentType: "image/jpeg", byteSize: 480_000 };

  it("is accepted as a photo or a PDF", () => {
    for (const contentType of PROOF_CONTENT_TYPES) {
      expect(proofProblem({ ...ok, contentType })).toBeNull();
    }
  });

  it("is refused for its type", () => {
    for (const contentType of ["image/gif", "text/html", "application/zip", ""]) {
      expect(proofProblem({ ...ok, contentType })).toBe("TYPE");
    }
  });

  it("is refused for its size", () => {
    expect(proofProblem({ ...ok, byteSize: PROOF_MAX_BYTES })).toBeNull();
    expect(proofProblem({ ...ok, byteSize: PROOF_MAX_BYTES + 1 })).toBe("SIZE");
    expect(proofProblem({ ...ok, byteSize: 0 })).toBe("SIZE");
  });
});
