"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@mbs/ui/components/select";
import { THEMES, useTheme } from "@mbs/ui/hooks/use-theme";
import { cn } from "cn";

/**
 * The theme control.
 *
 * `cookieSuffix` is computed on the server, in `theme-script.tsx`, because it
 * depends on `PROFILE_APEX`, and that is not inlined into the browser bundle
 * without a `NEXT_PUBLIC_` prefix, so a client component reading it would get
 * `undefined` and scope every local cookie to the production domain.
 *
 * The page itself is never wrong while this settles: the inline script has
 * already set the class before anything paints. This only decides which of the
 * three labels the control shows.
 */
export function ThemeSelect({
  cookieSuffix,
  compact = false,
  className,
}: {
  cookieSuffix: string;
  /** A 44px icon square below `md`, for a phone bar with no room for the label. */
  compact?: boolean;
  className?: string;
}) {
  const [theme, choose] = useTheme(cookieSuffix);
  const current = THEMES.find((option) => option.value === theme) ?? THEMES[0];

  return (
    <Select value={theme} onValueChange={choose}>
      {/* The visible label is the current mode rather than a bare icon,
          because "Sistem" and "Gelap" are not guessable from a glyph. A compact
          trigger drops it on a phone and accepts that cost; the name still
          says the mode, and the list it opens is labelled. */}
      <SelectTrigger
        size="touch"
        aria-label={`Tampilan: ${current.label}`}
        className={cn(
          compact && "max-md:w-11 max-md:justify-center max-md:[&>svg:last-child]:hidden",
          className,
        )}
      >
        <span className="flex items-center gap-1.5">
          <current.Icon aria-hidden className="size-4" strokeWidth={1.75} />
          <span className={compact ? "max-md:hidden" : undefined}>{current.label}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <option.Icon aria-hidden className="size-4" strokeWidth={1.75} />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
