"use client";

import { Button, buttonVariants } from "@mbs/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@mbs/ui/components/sheet";
import { cn } from "cn";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";

import { NAV_LINK, menuKey, type MenuEntry } from "./nav-link.ts";
import { ThemeSelect } from "./theme.tsx";

/**
 * The phone header's navigation, in a sheet.
 *
 * The control is labelled rather than a bare hamburger, and the panel names the
 * owner at the top: on a phone the sheet covers the header it came from, so
 * without that the visitor has left the only thing on screen that said which
 * school they were looking at.
 *
 * Every row is 44px, and the admission action sits at the bottom of the panel
 * rather than in the bar, where it would crowd the identity.
 */
export function MobileMenu({
  items,
  owner,
  admissionCta,
  cookieSuffix,
}: {
  items: readonly MenuEntry[];
  owner: string;
  admissionCta: string;
  /** Passed through to the theme control; see `theme-script.tsx` for why. */
  cookieSuffix: string;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="touch" className="order-2 gap-1.5 px-2 md:hidden" />}
      >
        {/* Stroke 1.75 against the 500-weight label beside it. */}
        <MenuIcon aria-hidden className="size-5.5" strokeWidth={1.75} />
        Menu
      </SheetTrigger>
      {/* From above, where the control is: the panel arrives over the header it
          was opened from instead of from an edge nothing was touching. */}
      <SheetContent side="top" showCloseButton={false} className="max-h-[85dvh] gap-0 pb-2">
        {/* The sheet ships a 28px close button — the committee scale. The
            visitor here is on a phone, so the panel brings its own at 44px and
            keeps the title's room for a long school name. */}
        <SheetHeader className="flex-row items-center justify-between gap-3">
          <SheetTitle>{owner}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon-touch" aria-label="Tutup menu" />}>
            <XIcon aria-hidden strokeWidth={1.75} />
          </SheetClose>
        </SheetHeader>
        {/* The list scrolls rather than the panel growing past the screen: at
            200% zoom on a phone, eight rows and the admission action are taller
            than the viewport, and a fixed panel would put the action out of
            reach. */}
        {/* The apex has no menu: an empty landmark would still be announced. */}
        {/* Block, not a flex column: in a column the links shrink below 44px
            to fit an open group instead of the list scrolling. */}
        {items.length > 0 && (
          <nav aria-label="Halaman" className="min-h-0 flex-1 overflow-y-auto px-4">
            {items.map((item) =>
              "links" in item ? (
                // Native disclosure: it opens with no script and announces its
                // state. Closed by default, so the list stays short. The
                // children are muted and indented rather than ruled off, so
                // they read as part of the group without extra lines.
                <details key={menuKey(item)} className="group">
                  <summary
                    className={cn(
                      NAV_LINK,
                      "flex h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden",
                    )}
                  >
                    {item.label}
                    <ChevronDownIcon
                      aria-hidden
                      strokeWidth={1.75}
                      className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <div className="flex flex-col pb-1 pl-4">
                    {/* The overview first, as in the desktop popover. */}
                    {[...(item.overview ? [item.overview] : []), ...item.links].map((link) => (
                      <a
                        key={menuKey(link)}
                        href={link.href}
                        className={cn(NAV_LINK, "flex h-11 items-center text-muted-foreground")}
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </details>
              ) : (
                <a
                  key={menuKey(item)}
                  href={item.href}
                  className={cn("flex h-11 items-center", NAV_LINK)}
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
        )}
        {/* The theme control follows the admission action rather than staying
            in the bar: below `md` the bar holds the identity alone, and a
            second control there is one too many at the width with least room.
            It wraps so that at 200% zoom the action drops to its own line
            instead of running off the screen. */}
        <div className="flex flex-wrap items-center gap-2 p-4">
          <ThemeSelect cookieSuffix={cookieSuffix} className="shrink-0" />
          <a href="/pendaftaran" className={cn(buttonVariants({ size: "touch" }), "flex-1")}>
            {admissionCta}
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
