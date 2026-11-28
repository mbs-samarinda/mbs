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
  it("takes a receipt straight from the browser", () => {
    expect(directives.get("connect-src")).toContain(BUCKET);
  });

  it("shows the receipt that was sent, and the one just chosen", () => {
    expect(directives.get("img-src")).toContain(BUCKET);
    // The preview of a file picked on the device, which never leaves it.
    expect(directives.get("img-src")).toContain("blob:");
  });
});
