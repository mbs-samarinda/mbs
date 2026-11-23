/**
 * Applies the visitor's theme before the page paints, so it has to be inline and
 * synchronous in the page's <head>. `use-theme.ts` is the same pair of changes
 * for when the visitor picks one. The app images allow this exact text by its
 * hash in their CSP, so an edit here moves the hash in their Caddyfiles too.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var media = matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      var match = document.cookie.match(/(?:^|; )theme=([^;]*)/);
      var stored = match ? decodeURIComponent(match[1]) : "";
      var dark = stored === "dark" || (stored !== "light" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }
    apply();
    media.addEventListener("change", apply);
  } catch (error) {
    // Never let this stop the page rendering. Light is the correct fallback:
    // it is the default theme.
  }
})();
`;
