import type { Metadata } from "next";

import { type Media, mediaUrl } from "./cms/client.ts";
import type { Owner } from "./owners.ts";

/** The width link previews ask for. One of Next's default image widths. */
const SHARE_WIDTH = 1200;

/**
 * A share image through Next's image optimizer rather than the raw upload, so a
 * phone photo of several megabytes reaches WhatsApp at a preview's size. The
 * optimizer never enlarges, so a narrower photo keeps its own size. An SVG, or
 * a file without a known width, goes out as uploaded: the optimizer refuses
 * SVG, and there is no size to scale.
 */
export function shareImage(image: Media) {
  if (/\.svg$/i.test(image.url) || !(image.width > 0)) {
    return { url: mediaUrl(image), alt: image.alternativeText ?? undefined };
  }
  const width = Math.min(SHARE_WIDTH, image.width);
  return {
    url: `/_next/image?url=${encodeURIComponent(mediaUrl(image))}&w=${SHARE_WIDTH}&q=75`,
    width,
    height: Math.round((image.height * width) / image.width),
    alt: image.alternativeText ?? undefined,
  };
}

/**
 * Each owner's own card, used when a page has no photo to share. A fixed file
 * in `public/<owner>/` rather than one drawn per request: drawing needs a TTF
 * copy of the font, and the trade is that a renamed school or a new tagline
 * means remaking the file.
 */
function fallbackImage(owner: Owner) {
  return { url: "/og.png", width: 1200, height: 630, alt: owner.name };
}

/**
 * The description, canonical address and share tags for one page.
 *
 * Every page builds its own set here because Next replaces a parent's
 * `openGraph` whole rather than merging it, so a site name set in the layout
 * would vanish from any page that adds an image. A missing description is left
 * out rather than set to `undefined`: an `undefined` key replaces the layout's
 * tagline too, which left every page without one. The page's own title fills
 * `og:title`, because Next copies it in when `openGraph` has none.
 *
 * `path` is relative to the owner's home, without a leading slash, and resolves
 * against the layout's per-owner `metadataBase`.
 */
export function shareMetadata(
  owner: Owner,
  path: string,
  {
    description,
    image,
    publishedTime,
  }: {
    description?: string | null | undefined;
    image?: Media | null | undefined;
    /** Marks the page as an article. */
    publishedTime?: string | undefined;
  } = {},
): Metadata {
  const url = `/${path}`;
  return {
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    openGraph: {
      siteName: owner.name,
      locale: "id_ID",
      url,
      ...(description ? { description } : {}),
      images: [image ? shareImage(image) : fallbackImage(owner)],
      ...(publishedTime ? { type: "article", publishedTime } : { type: "website" }),
    },
  };
}
