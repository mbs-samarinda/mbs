"use client";

import { cn } from "cn";
import { useLinkStatus } from "next/link";
import { useEffect } from "react";

const STATUS_ID = "link-status";

/**
 * A small spinner in the corner of a card whose page is still loading, and the
 * same news for a screen reader through `LinkStatus`. Detail pages wait for the
 * CMS before they show anything (see `/artikel/[type]/[slug]`), and a
 * client-side navigation has no browser loading bar, so without this a slow tap
 * looks like it did nothing. Goes inside the card's `<Link>`, which must be
 * `relative`. The look is `.pending-spinner` in `globals.css`; `className`
 * moves it where a card's corner is not its photo's.
 */
export function PendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  // Spoken after the same 150ms the spinner waits, so a fast page says nothing.
  useEffect(() => {
    const region = document.getElementById(STATUS_ID);
    if (!pending || !region) return undefined;
    const timer = setTimeout(() => {
      region.textContent = "Memuat halaman…";
    }, 150);
    return () => {
      clearTimeout(timer);
      region.textContent = "";
    };
  }, [pending]);

  return pending ? (
    <span aria-hidden className={cn("pending-spinner absolute top-2.5 right-2.5 z-1", className)} />
  ) : null;
}

/**
 * The one live region `PendingSpinner` speaks through, in the layout. There
 * rather than in each card because the layout outlives the page change, so a
 * message is never cut off by its card leaving, and a link's content stays its
 * own. Always present: a screen reader announces a region's text changing, not
 * the region appearing.
 */
export const LinkStatus = () => <output id={STATUS_ID} className="sr-only" />;
