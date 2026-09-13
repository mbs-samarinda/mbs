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
import { MenuIcon, XIcon } from "lucide-react";

import { NAV_LINK } from "./nav-link.ts";

type Item = { readonly href: string; readonly label: string };

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
}: {
  items: readonly Item[];
  owner: string;
  admissionCta: string;
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
        <nav aria-label="Halaman" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
          {items.map((item) => (
            <a key={item.href} href={item.href} className={cn("flex h-11 items-center", NAV_LINK)}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="p-4">
          <a href="/pendaftaran" className={cn(buttonVariants({ size: "touch" }), "w-full")}>
            {admissionCta}
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
