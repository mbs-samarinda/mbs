import { describe, expect, it } from "vitest";

import { readGrant, signGrant, type UploadGrant } from "./grant.ts";

const SECRET = "test-secret-that-is-long-enough-to-pass";
const NOW = new Date("2026-03-01T04:00:00.000Z");

const grant: UploadGrant = {
  key: "payment-proofs/9f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
  applicationId: "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  userId: "ySxQ4m0Qk5s2bWgJ7hTcPz",
  contentType: "image/jpeg",
  byteSize: 480_000,
  sha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  expiresAt: NOW.getTime() + 60_000,
};

describe("an upload grant", () => {
  it("comes back as it was signed", () => {
    expect(readGrant(SECRET, signGrant(SECRET, grant), NOW)).toEqual(grant);
  });

  it("is refused once it has run out", () => {
    const later = new Date(grant.expiresAt + 1);
    expect(readGrant(SECRET, signGrant(SECRET, grant), later)).toBeNull();
  });

  it("is refused when its body was changed", () => {
    const token = signGrant(SECRET, grant);
    const forged = signGrant(SECRET, { ...grant, byteSize: 9_000_000 }).split("\u0000")[0];

    expect(readGrant(SECRET, `${forged}\u0000${token.split("\u0000")[1]}`, NOW)).toBeNull();
  });

  it("is refused when another secret signed it", () => {
    expect(readGrant(SECRET, signGrant("another-secret-long-enough-xxxxx", grant), NOW)).toBeNull();
  });

  it("is refused when it is not a token at all", () => {
    for (const token of ["", "nonsense", "a\u0000b"]) {
      expect(readGrant(SECRET, token, NOW)).toBeNull();
    }
  });
});
