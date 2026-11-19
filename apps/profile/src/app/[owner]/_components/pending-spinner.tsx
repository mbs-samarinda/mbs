"use client";

import { cn } from "cn";
import { useLinkStatus } from "next/link";

/**
 * A small spinner in the corner of a card whose page is still loading. Detail
 * pages wait for the CMS before they show anything (see `/artikel/[type]/[slug]`),
 * and a client-side navigation has no browser loading bar, so without this a
 * slow tap looks like it did nothing. Goes inside the card's `<Link>`, which
 * must be `relative`. The look is `.pending-spinner` in `globals.css`;
 * `className` moves it where a card's corner is not its photo's.
 */
export function PendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <span aria-hidden className={cn("pending-spinner absolute top-2.5 right-2.5 z-1", className)} />
  ) : null;
}
