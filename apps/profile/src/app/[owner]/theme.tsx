"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@mbs/ui/components/select";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

// Three states rather than a light/dark switch: with a switch, a visitor who
// overrides once can never go back to following their operating system without
// clearing site data. `Sistem` is the default and stays reachable.
const OPTIONS = [
  { value: "system", label: "Sistem", Icon: MonitorIcon },
  { value: "light", label: "Terang", Icon: SunIcon },
  { value: "dark", label: "Gelap", Icon: MoonIcon },
] as const;

const isTheme = (value: string): value is Theme => OPTIONS.some((option) => option.value === value);

const DARK = "(prefers-color-scheme: dark)";
const CHANGED = "mbs:theme";

// What the server renders and what hydration matches against. The visitor's
// real choice arrives on the first client snapshot, a moment later.
const SERVER_THEME: Theme = "system";

/**
 * Paints the choice.
 *
 * `color-scheme` alongside the class, for the surfaces CSS does not reach —
 * scrollbars and native form controls. The inline script sets both on load;
 * this is the same pair, applied when the visitor changes it.
 *
 * Transitions are suppressed for one frame first. Buttons and links carry a
 * colour transition, so without this every one of them animates its own way
 * across the flip and the page ripples for 200ms.
 */
function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia(DARK).matches);

  const freeze = document.createElement("style");
  freeze.textContent = "*, *::before, *::after { transition: none !important }";
  document.head.append(freeze);

  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";

  // Forces the style change to be applied while transitions are still off.
  // Reading a layout property is what flushes it; without the read the browser
  // batches both changes and the suppression never takes effect.
  void document.body.offsetHeight;
  freeze.remove();
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
 * `storage` event; cookies fire no event, and the two-store version — cookie
 * for truth, `localStorage` for the signal — is exactly the kind of pair that
 * drifts. Two open tabs disagree until the next navigation, which is a smaller
 * problem than that.
 */
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
 * The theme control.
 *
 * `cookieSuffix` is computed on the server, in `theme-script.tsx`, because it
 * depends on `PROFILE_APEX` — and that is not inlined into the browser bundle
 * without a `NEXT_PUBLIC_` prefix, so a client component reading it would get
 * `undefined` and scope every local cookie to the production domain.
 *
 * The page itself is never wrong while this settles — the inline script has
 * already set the class before anything paints. This only decides which of the
 * three labels the control shows.
 */
export function ThemeSelect({
  cookieSuffix,
  className,
}: {
  cookieSuffix: string;
  className?: string;
}) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => SERVER_THEME);

  // While following the operating system, the page has to keep up with it: a
  // visitor whose phone switches to dark at sunset should not have to reload.
  useEffect(() => {
    if (theme !== "system") return () => {};

    const media = matchMedia(DARK);
    const update = () => apply("system");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const choose = (value: Theme | null) => {
    if (!value || !isTheme(value)) return;

    const secure = globalThis.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `theme=${value}${cookieSuffix}${secure}`;
    apply(value);
    globalThis.dispatchEvent(new Event(CHANGED));
  };

  const current = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[0];

  return (
    <Select value={theme} onValueChange={choose}>
      {/* Labelled for assistive technology, and the visible label is the
          current mode rather than a bare icon — "Sistem" and "Gelap" are not
          guessable from a glyph. */}
      <SelectTrigger size="touch" aria-label="Tampilan" className={className}>
        <span className="flex items-center gap-1.5">
          <current.Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {current.label}
        </span>
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <option.Icon aria-hidden className="size-4" strokeWidth={1.75} />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
