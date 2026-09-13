"use client";

import { Button } from "@mbs/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NAV_LINK } from "./nav-link.ts";

type Item = { readonly href: string; readonly label: string };

/**
 * The navigation row, always on one line, with an arrow over whatever is cut
 * off.
 *
 * Wrapping was the first version: it changed the height of the bar and read as
 * two rows of navigation. A visible scrollbar was the second: it sits on top of
 * the labels it is meant to serve. So the track scrolls with its scrollbar
 * hidden, and an arrow is the affordance.
 *
 * The arrows are positioned over the track rather than beside it, so they take
 * no layout space: one appearing as the window narrows moves nothing, and a
 * desktop row where everything fits carries no chrome at all.
 *
 * Each arrow sits on a solid page-coloured plate, with the gradient as a strip
 * beside it rather than underneath. A gradient that ran under the arrow left
 * the label showing through wherever it had already gone part-transparent —
 * the sliver that kept appearing next to the chevron. Solid where the control
 * is, fading only on the side the labels continue.
 *
 * Neither plate takes pointer events; only the button does. An overlay that
 * swallows the clicks of whatever it covers is a failure this design has
 * already removed once.
 */
export function NavScroller({ items, className }: { items: readonly Item[]; className: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const element = track.current;
    if (!element) return () => {};

    const update = () =>
      setEdges({
        start: element.scrollLeft > 1,
        // A pixel of slack: fractional widths leave scrollLeft a hair short of
        // the end, which would otherwise keep the arrow up with nothing left to
        // reach.
        end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });

    update();
    element.addEventListener("scroll", update, { passive: true });
    // The row starts or stops overflowing as the window resizes and as the
    // labels change, and neither fires a scroll event.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);

    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
    // Runs once: the observer watches the track and its children, so nothing
    // here depends on a rerender.
  }, []);

  const page = (direction: -1 | 1) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  return (
    <nav aria-label="Halaman" className={`relative ${className}`}>
      {/* `scroll-px-12` keeps a link that is reached by keyboard from landing
          under an arrow when the browser scrolls it into view. */}
      <div
        ref={track}
        // On a desktop page the row is centred in what is left between the
        // brand and the CTA. `safe center` rather than plain centring: when the
        // labels outgrow the space, centred overflow pushes the first of them
        // past the scroll origin where nothing can reach it, and `safe` falls
        // back to start alignment exactly then. The tablet row keeps its own
        // left edge, which is where the brand above it starts.
        className="flex w-full scroll-px-12 [scrollbar-width:none] items-center gap-6 overflow-x-auto whitespace-nowrap lg:[justify-content:safe_center] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <a key={item.href} href={item.href} className={NAV_LINK}>
            {item.label}
          </a>
        ))}
      </div>

      {/* Both plates are held 8px past the track's edge rather than flush: on
          the edge itself the clip boundary lands against the arrow and a column
          of the neighbouring label shows at the seam. */}
      {edges.start && (
        <div className="pointer-events-none absolute inset-y-0 -left-2 flex items-center bg-background pr-2 before:absolute before:top-0 before:left-full before:h-full before:w-10 before:bg-linear-to-r before:from-background before:to-transparent before:content-['']">
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label="Geser navigasi ke kiri"
            onClick={() => page(-1)}
            className="pointer-events-auto bg-background hover:bg-muted"
          >
            <ChevronLeftIcon aria-hidden strokeWidth={1.75} />
          </Button>
        </div>
      )}
      {edges.end && (
        <div className="pointer-events-none absolute inset-y-0 -right-2 flex items-center bg-background pl-2 before:absolute before:top-0 before:right-full before:h-full before:w-10 before:bg-linear-to-l before:from-background before:to-transparent before:content-['']">
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label="Geser navigasi ke kanan"
            onClick={() => page(1)}
            className="pointer-events-auto bg-background hover:bg-muted"
          >
            <ChevronRightIcon aria-hidden strokeWidth={1.75} />
          </Button>
        </div>
      )}
    </nav>
  );
}
