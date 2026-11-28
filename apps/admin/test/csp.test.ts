import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { THEME_SCRIPT } from "@mbs/ui/theme-script";
import { describe, expect, it } from "vitest";

/**
 * The policy as Caddy will send it, by directive. Vite serves no CSP, so every
 * test and every verification run sees a laxer browser than a visitor does.
 * This file is the only place the real policy is checked.
 */
function policy() {
  const caddyfile = readFileSync(`${import.meta.dirname}/../Caddyfile`, "utf8");
  const [, header] = /Content-Security-Policy "([^"]+)"/.exec(caddyfile) ?? [];
  if (!header) throw new Error("no Content-Security-Policy in the Caddyfile");
  return new Map(
    header.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

/** Caddy replaces this with S3_ENDPOINT, which compose passes to both apps. */
const BUCKET = "{$S3_PUBLIC_ORIGIN}";

const directives = policy();

it("allows the inline theme script by its hash", () => {
  const hash = createHash("sha256").update(THEME_SCRIPT).digest("base64");
  expect(directives.get("script-src")).toEqual(["'self'", `'sha256-${hash}'`]);
});

describe("the bucket", () => {
  it("shows a family's receipt", () => {
    expect(directives.get("img-src")).toContain(BUCKET);
  });

  it("stays out of connect-src, because nothing here uploads", () => {
    expect(directives.get("connect-src")).toEqual(["'self'"]);
  });
});
