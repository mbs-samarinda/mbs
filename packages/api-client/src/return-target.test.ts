import { describe, expect, it } from "vitest";

import { safeReturnTarget } from "./return-target.ts";

const origin = "https://admission.mbss.sch.id";
const target = (value: unknown) => safeReturnTarget(value, { signInPath: "/masuk", origin });

describe("the page to return to after sign-in", () => {
  it.each(["/status", "/status?anak=2", "/status/2#berkas", "/a%2Fb", "/?dari=profil"])(
    "keeps %s",
    (value) => expect(target(value)).toBe(value),
  );

  it.each([
    "https://evil.test/status",
    "//evil.test",
    "///evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "/status\\..\\evil",
    "/\t/evil.test",
    "/\n/evil.test",
    "/.//evil.test",
    "/x/..//evil.test",
    "javascript:alert(1)",
    "status",
    "",
    undefined,
    null,
    7,
    ["/status"],
  ])("drops %j", (value) => expect(target(value)).toBeUndefined());

  it("drops the home page and the sign-in pages, which need no return", () => {
    for (const value of ["/", "/masuk", "/masuk?lanjut=/status", "/masuk/kode", "/x/../masuk"]) {
      expect(target(value), value).toBeUndefined();
    }
    expect(target("/masukan")).toBe("/masukan");
  });
});
