import type { StrapiApp } from "@strapi/strapi/admin";

/**
 * The admin panel wears the umbrella's colours.
 *
 * Only the primary ramp is replaced. Strapi's neutrals, danger, success and
 * warning are left exactly as they ship:
 *
 * - Recolouring `danger` or `success` would break "one colour, one meaning" —
 *   destructive has to stay red whatever the brand is.
 * - The neutral ramp carries almost every text pair in the product. Rebuilding
 *   it buys no brand recognition and risks contrast failures on screens nobody
 *   would think to recheck.
 * - `alternative` stays purple. The umbrella's accent is the orange `#f26420`,
 *   and DESIGN.md is explicit that accents take dark text only and follow the
 *   Rare Orange Rule. Strapi fills `alternative` surfaces and puts light text
 *   on them, so the brand accent does not belong there.
 *
 * Values come from the palette approved on 12 September 2026 (DESIGN.md,
 * "School palettes"). The gaps Strapi needs and the guide does not define were
 * computed in OKLCH holding the primary's hue, 219.2, so the ramp keeps one hue
 * end to end with chroma peaking in the middle.
 */

/** Light: page is `neutral0` #ffffff, body text `neutral800` #32324d. */
const light = {
  // Selected rows, hovered menu items — a tint, never a text colour.
  // Body text on it measures 10.69:1.
  primary100: "#e7f0f3", // approved "surface tint"
  // Borders on that tint.
  primary200: "#c0dde7", // computed, L 0.879
  // The lighter step. Strapi uses it for borders and subtle hovers, and its own
  // value here carries white at only 3.49:1 — so this one is not a white-text
  // surface either, by the same design. Nothing is regressed; it matches the
  // role it already had.
  primary500: "#4495ad", // computed, L 0.629
  // The solid brand fill: buttons, links, active navigation.
  // White on it: 5.85:1. As link text on white: 5.85:1.
  primary600: "#126e84", // approved "primary (action)"
  // Pressed and darkest. White on it: 8.13:1.
  primary700: "#00576d", // approved "hover"

  // Buttons take `color: neutral0`, so white sits on BOTH of these.
  //
  // Strapi's defaults are #4945ff and a *lighter* #7b79ff, and white on that
  // lighter one is 3.49:1 — a failure in the shipped theme. Hover goes darker
  // here instead, which is what DESIGN.md prescribes anyway and what keeps the
  // label readable through the whole interaction.
  buttonPrimary500: "#00576d", // hover — white 8.13:1
  buttonPrimary600: "#126e84", // rest — white 5.85:1
};

/** Dark: page is `neutral0` #212134. Primaries rise into the 0.78 band. */
const dark = {
  primary100: "#0d2127", // computed, L 0.234 — dark tint
  primary200: "#224b57", // computed, L 0.389 — border
  primary500: "#126e84", // the light-mode primary, as the darker step
  // Approved dark-mode umbrella primary. Dark label on it: 8.09:1 against
  // Strapi's `neutral0`, 9.45:1 against the guide's own ink. As link text on
  // the dark page: 8.09:1.
  primary600: "#74c5dd",
  primary700: "#9ad9ed", // computed, L 0.850

  // Strapi keeps its button fills identical across themes. Matching that, the
  // filled button stays the light-mode pair so a primary action looks the same
  // in both — and white still reads on it at 5.85:1 and 8.13:1.
  buttonPrimary500: "#00576d",
  buttonPrimary600: "#126e84",
};

export default {
  config: {
    theme: {
      light: { colors: light },
      dark: { colors: dark },
    },
  },
  bootstrap(_app: StrapiApp) {},
};
