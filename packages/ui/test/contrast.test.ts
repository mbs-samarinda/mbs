import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

// The alarm pair is the one place where a token's value and its accessibility
// are the same fact: the ink exists to be read on the tint. A wrong value looks
// fine and measures 4.36:1, which is how shadcn's stock red survived here, so
// the ratio is asserted rather than trusted.
//
// This file sits outside `src` so that reading the stylesheet does not put Node
// globals in scope for a component library that ships to a browser. The cost is
// that tsc does not check it; vitest and oxlint still do.

type Oklch = readonly [l: number, c: number, h: number];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

/** Reads one custom property out of a `:root` or `.dark` block. */
function token(block: ":root" | ".dark", name: string): Oklch {
  const body = css.split(`\n${block} {`)[1]?.split("\n}")[0] ?? "";
  const m = body.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m?.[1] || !m[2] || !m[3]) {
    throw new Error(`--${name} is not a plain oklch() value in ${block}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Relative luminance, with out-of-gamut channels clipped per channel. Browsers
 * gamut-map by reducing chroma instead, so keep tokens inside sRGB — every token
 * asserted here is, by at most 0.0005 in linear light. */
function luminance([L, C, H]: Oklch): number {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return (
    0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

function contrast(a: Oklch, b: Oklch): number {
  const [x, y] = [luminance(a), luminance(b)];
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05);
}

test.for([":root", ".dark"] as const)("alarm ink carries text on its own tints in %s", (block) => {
  const ink = token(block, "destructive");
  for (const surface of ["destructive-tint", "destructive-tint-hover", "background"]) {
    expect(contrast(ink, token(block, surface)), `ink on --${surface}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("the alarm ink is the guide's darker red, not the error red #e7000b", () => {
  // The two reds share a hue and differ by 0.07 in lightness, so lightness is
  // the whole of what separates them, and only the darker one carries a label
  // on the tint. Bounding it is what stops the stock value drifting back.
  expect(token(":root", "destructive")[0]).toBeLessThanOrEqual(0.52);
});
