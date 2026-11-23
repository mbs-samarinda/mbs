import { cn } from "cn";

import { THEMES, useTheme } from "../hooks/use-theme.ts";

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

/**
 * An icon of the current choice, drawn over a native select that holds its text
 * out of view. A phone shows its own picker, and it costs no script. The glyph
 * alone is hard to guess, so a mouse also gets the name on hover.
 */
function ThemeSelect({ size, className }: { size: "default" | "touch"; className?: string }) {
  const [theme, choose] = useTheme(cookieSuffix());
  const { Icon } = THEMES.find((option) => option.value === theme) ?? THEMES[0];
  return (
    <span
      title="Tampilan"
      className={cn(
        "relative inline-grid shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground",
        size === "touch" ? "size-11" : "size-8",
        className,
      )}
    >
      <select
        aria-label="Tampilan"
        value={theme}
        onChange={(event) => choose(event.target.value)}
        className={cn(
          // The padding leaves the text no room, for forced colors, which repaint transparent text.
          "absolute inset-0 size-full cursor-pointer appearance-none bg-transparent pl-[100%] text-base text-transparent transition-colors hover:bg-muted dark:hover:bg-muted/50",
          size === "touch" ? "rounded-xl" : "rounded-lg",
        )}
      >
        {THEMES.map(({ value, label }) => (
          // The system's own colors: an option paints on the browser's menu, not the page.
          <option key={value} value={value} className="bg-[Canvas] text-[CanvasText]">
            {label}
          </option>
        ))}
      </select>
      <Icon
        aria-hidden
        className={cn("pointer-events-none relative", size === "touch" ? "size-5" : "size-4")}
        strokeWidth={1.75}
      />
    </span>
  );
}

export { ThemeSelect };
