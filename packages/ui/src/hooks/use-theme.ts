import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

// Three states rather than a light/dark switch: with a switch, a visitor who
// overrides once can never go back to following their operating system without
// clearing site data. `Sistem` is the default and stays reachable.
export const THEMES = [
  { value: "system", label: "Sistem", Icon: MonitorIcon },
  { value: "light", label: "Terang", Icon: SunIcon },
  { value: "dark", label: "Gelap", Icon: MoonIcon },
] as const;

const isTheme = (value: string): value is Theme => THEMES.some((theme) => theme.value === value);

const DARK = "(prefers-color-scheme: dark)";
const CHANGED = "mbs:theme";

// What the server renders and what hydration matches against. The visitor's
// real choice arrives on the first client snapshot, a moment later.
const SERVER_THEME: Theme = "system";

/**
 * Paints the choice.
 *
 * `color-scheme` alongside the class, for the surfaces CSS does not reach:
 * scrollbars and native form controls. `theme-script.ts` sets both on load; this
 * is the same pair, applied when the visitor changes it.
 *
 * Transitions are off for the flip. Buttons and links carry a colour transition,
 * so without this every one of them animates its own way across and the page
 * ripples for 200ms. A class, because a CSP can refuse an injected <style>.
 */
function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia(DARK).matches);
  const root = document.documentElement;

  root.classList.add("theme-changing");
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";

  // Forces the style change to be applied while transitions are still off.
  // Reading a layout property is what flushes it; without the read the browser
  // batches both changes and the suppression never takes effect.
  void document.body.offsetHeight;
  root.classList.remove("theme-changing");
}

function subscribe(onChange: () => void) {
  globalThis.addEventListener(CHANGED, onChange);
  return () => globalThis.removeEventListener(CHANGED, onChange);
}

function readTheme(): Theme {
  const match = document.cookie.match(/(?:^|; )theme=([^;]*)/);
  const stored = match?.[1] ? decodeURIComponent(match[1]) : "";
  return isTheme(stored) ? stored : "system";
}

/**
 * The stored choice, read as what it is: state owned by the browser rather than
 * by React.
 *
 * `useSyncExternalStore` instead of state seeded in an effect. The effect
 * version renders once with the wrong label and then corrects itself, which is
 * a visible flicker on the control and the pattern the lint rule exists to
 * stop. This has a server snapshot for hydration and the real value immediately
 * after, with no extra render of our own.
 *
 * There is no cross-tab sync. `localStorage` had it for free through the
 * `storage` event; cookies fire no event, and the two-store version, a cookie
 * for truth and `localStorage` for the signal, is exactly the kind of pair that
 * drifts. Two open tabs disagree until the next navigation, which is a smaller
 * problem than that.
 *
 * `cookieSuffix` holds the cookie's path, age and domain. The caller owns it
 * because only the caller knows which hosts share the choice.
 */
export function useTheme(cookieSuffix: string) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => SERVER_THEME);

  const choose = (value: string | null) => {
    if (!value || !isTheme(value)) return;

    const secure = globalThis.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `theme=${value}${cookieSuffix}${secure}`;
    apply(value);
    globalThis.dispatchEvent(new Event(CHANGED));
  };

  return [theme, choose] as const;
}
