import { THEMES, useTheme } from "../hooks/use-theme.ts";
import { NativeSelect, NativeSelectOption } from "./native-select.tsx";

/**
 * `theme=<value>` scoped to the parent domain, as the profile sites write it, so
 * a choice made there holds here. A host-only cookie would lose to that one.
 * Local hosts get no domain, because browsers refuse one.
 */
function cookieSuffix() {
  const host = globalThis.location.hostname;
  const apex = host.slice(host.indexOf(".") + 1);
  const isLocal = !apex.includes(".") || /^[\d.]+$/.test(host);
  return `; path=/; max-age=31536000; samesite=lax${isLocal ? "" : `; domain=.${apex}`}`;
}

/** A native select: a phone shows its own picker, and it costs no script. */
function ThemeSelect({ size }: { size: "default" | "touch" }) {
  const [theme, choose] = useTheme(cookieSuffix());
  return (
    <NativeSelect
      size={size}
      aria-label="Tampilan"
      value={theme}
      onChange={(event) => choose(event.target.value)}
    >
      {THEMES.map(({ value, label }) => (
        <NativeSelectOption key={value} value={value}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export { ThemeSelect };
