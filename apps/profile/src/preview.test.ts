import { createHmac } from "node:crypto";

import { expect, test } from "vitest";

import { isValidSession, sessionValue, SESSION_S, verifyLink } from "./preview.ts";

const SECRET = "a-preview-secret-of-at-least-32-chars";
const NOW = 1_800_000_000;

/** Signs a link the way `apps/cms/src/preview.ts` does. */
function link(owner: string, path: string, mode: string, exp = NOW + 3600, secret = SECRET) {
  const sig = createHmac("sha256", secret)
    .update([owner, path, mode, String(exp)].join("\n"))
    .digest("hex");
  return new URLSearchParams({ path, mode, exp: String(exp), sig });
}

test("a link signed for this school opens its page", () => {
  expect(verifyLink(SECRET, "smp", link("smp", "/artikel/berita/x", "draft"), NOW)).toEqual({
    path: "/artikel/berita/x",
    mode: "draft",
  });
  expect(verifyLink(SECRET, "smp", link("smp", "/", "published"), NOW)?.mode).toBe("published");
});

test("a link is refused on another school, after it expires, or once edited", () => {
  expect(verifyLink(SECRET, "sma", link("smp", "/", "draft"), NOW)).toBeNull();
  expect(verifyLink(SECRET, "smp", link("smp", "/", "draft", NOW - 1), NOW)).toBeNull();
  expect(
    verifyLink(SECRET, "smp", link("smp", "/", "draft", NOW, "another-secret"), NOW),
  ).toBeNull();

  const edited = link("smp", "/profil", "draft");
  edited.set("path", "/kontak");
  expect(verifyLink(SECRET, "smp", edited, NOW)).toBeNull();
  expect(verifyLink(SECRET, "smp", new URLSearchParams(), NOW)).toBeNull();
});

test("even a correctly signed link never leaves the host", () => {
  for (const path of ["//evil.example", "/\\evil.example", "https://evil.example", "profil"]) {
    expect(verifyLink(SECRET, "smp", link("smp", path, "draft"), NOW), path).toBeNull();
  }
});

test("a preview session belongs to one school and ends", () => {
  const value = sessionValue(SECRET, "smp", NOW);
  expect(isValidSession(SECRET, "smp", value, NOW)).toBe(true);
  expect(isValidSession(SECRET, "sma", value, NOW)).toBe(false);
  expect(isValidSession(SECRET, "smp", value, NOW + SESSION_S + 1)).toBe(false);
  expect(isValidSession(SECRET, "smp", undefined, NOW)).toBe(false);
  expect(isValidSession(SECRET, "smp", `${NOW + 10 ** 6}.${value.split(".")[1]}`, NOW)).toBe(false);
});
