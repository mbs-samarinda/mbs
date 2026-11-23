import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { THEME_SCRIPT } from "@mbs/ui/theme-script";
import { expect, it } from "vitest";

it("allows the inline theme script by its hash", () => {
  const caddyfile = readFileSync(`${import.meta.dirname}/../Caddyfile`, "utf8");
  const hash = createHash("sha256").update(THEME_SCRIPT).digest("base64");
  expect(caddyfile).toContain(`script-src 'self' 'sha256-${hash}'`);
});
