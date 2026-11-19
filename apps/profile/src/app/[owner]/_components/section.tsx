import Image from "next/image";
import Link from "next/link";
import { type ReactNode } from "react";

import { mediaUrl, type Media } from "@/cms/client.ts";

/**
 * The pieces every composed page is built from.
 *
 * They sit beside the pages rather than inside one: the admission band, the
 * fact strip and the photo slot are each drawn once on the canvas and appear on
 * several routes, and the band in particular is the same component on the home
 * page and on `/pendaftaran`.
 */

/** Section rhythm: 48px at tablet, 120px on a desktop page, per the canvas. */
export const SECTION = "px-4 py-12 md:px-12 md:py-12 lg:px-30 lg:py-15";
export const WIDTH = "mx-auto w-full max-w-300";

/** The title and standfirst a content page opens with. */
export const PageHead = ({ heading, body }: { heading: string; body: string }) => (
  <section className={`${SECTION} pb-0 md:pb-0 lg:pb-0`}>
    <div className={`${WIDTH} flex flex-col gap-3`}>
      <h1 className="text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
        {heading}
      </h1>
      <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{body}</p>
    </div>
  </section>
);

export function SectionHeading({
  head,
}: {
  head: {
    heading: string;
    description: string | null;
    linkLabel: string | null;
    linkHref: string | null;
  };
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[28px] font-bold text-balance">{head.heading}</h2>
        {head.description && (
          <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">
            {head.description}
          </p>
        )}
      </div>
      {head.linkLabel && head.linkHref && (
        <Link
          href={head.linkHref}
          className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4"
        >
          {head.linkLabel}
        </Link>
      )}
    </div>
  );
}

/**
 * A photograph, or the labelled slot standing in for one.
 *
 * No photography has been supplied for any owner, so the slot is the normal
 * state today rather than an error. The outline is what keeps a photo from
 * dissolving into the page — white photos into a white page, dark ones into a
 * dark page — so it flips with the mode and is dropped only inside a bordered
 * card, where the card's own border already draws that edge.
 */
export function Photo({
  image,
  label,
  className,
  inCard = false,
  sizes,
}: {
  image: Media | null;
  label: string;
  className: string;
  inCard?: boolean;
  /**
   * How wide the photo renders, for a grid of small ones. Without it the browser
   * picks from the photo's own width, so a phone downloads a full-size original
   * for every thumbnail.
   */
  sizes?: string;
}) {
  const edge = inCard ? "" : "outline outline-black/10 dark:outline-white/12";

  if (!image) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-muted text-[11px] font-semibold tracking-wide text-muted-foreground uppercase ${edge} ${className}`}
      >
        {label}
      </div>
    );
  }

  return (
    <Image
      src={mediaUrl(image)}
      alt={image.alternativeText ?? ""}
      width={image.width}
      height={image.height}
      sizes={sizes}
      className={`rounded-lg object-cover ${edge} ${className}`}
    />
  );
}

export const FactStrip = ({ children }: { children: ReactNode }) => (
  <dl className="flex flex-wrap gap-x-8 gap-y-3">{children}</dl>
);

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* Tabular figures on every date, fee and count: proportional digits make
          a row of facts ragged and a changing value jump. */}
      <dd className="text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
