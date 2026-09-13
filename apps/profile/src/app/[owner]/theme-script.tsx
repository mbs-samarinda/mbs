// Overridable so a staging deploy scopes its cookie to its own domain, exactly
// as `owners.ts` resolves hosts. Read here and baked into prerendered pages, so
// it is a build input like `PROFILE_APEX` already is for the school switcher.
const APEX = process.env.PROFILE_APEX ?? "mbss.sch.id";

/**
 * Everything after `theme=<value>` when writing the cookie.
 *
 * A cookie on the parent domain rather than `localStorage`, because the four
 * owners are four origins and `localStorage` is per origin: choosing Gelap on
 * the SMK site and then using the school switcher would land on SMA in Sistem.
 * The switcher's whole job is moving between these hosts, so the preference has
 * to move with it.
 *
 * Local hosts get no `domain` at all. Browsers refuse a `.localhost` cookie
 * domain, so the cookie stays host-only there and the preference is per host in
 * development and shared in production. That divergence is the price of local
 * subdomains; it is written down here rather than discovered.
 *
 * A year, because a visitor who set this last term should not be asked again.
 * Lax is right: nothing here is a cross-site form post.
 */
export const COOKIE_SUFFIX =
  `; path=/; max-age=31536000; samesite=lax` +
  (APEX.endsWith("localhost") ? "" : `; domain=.${APEX}`);

/**
 * Applies the visitor's theme before the page paints.
 *
 * It has to be an inline, synchronous script. React cannot do this: the class
 * depends on a cookie and on the operating system, and the alternative — having
 * the server read the cookie — would make every page dynamic and undo the
 * static rendering this whole application is shaped around.
 *
 * It also sets `color-scheme`, which is what tells the browser to darken the
 * things CSS does not own: scrollbars, form controls, and the space behind an
 * overscroll. Without it a dark page keeps a white scrollbar.
 *
 * Unset means follow the operating system, which is the rule: dark mode is
 * never forced on a visitor who has not asked for it.
 *
 * This file deliberately has no `"use client"`. The script's text is a
 * constant, and a constant exported from a client module arrives in a server
 * component as a reference proxy — it would be stringified into the attribute
 * and never run. `nav-link.ts` carries the same warning for the same reason.
 */
const SCRIPT = `
(function () {
  try {
    var match = document.cookie.match(/(?:^|; )theme=([^;]*)/);
    var stored = match ? decodeURIComponent(match[1]) : "";
    var dark = stored === "dark" ||
      (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (error) {
    // Never let this stop the page rendering. Light is the correct fallback:
    // it is the default theme.
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
