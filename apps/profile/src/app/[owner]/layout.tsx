import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LinkStatus } from "@/app/[owner]/_components/pending-spinner.tsx";
import { jakarta } from "@/app/_components/font.ts";
import { JsonLd, organizationOf } from "@/app/_components/json-ld.tsx";
import { Footer, Header } from "@/app/_components/shell.tsx";
import { ThemeScript } from "@/app/_components/theme-script.tsx";
import { mediaUrl } from "@/cms/client.ts";
import { getSite, type Site } from "@/cms/site.ts";
import { type Owner, OWNERS, ownerUrl, requireOwner } from "@/owners.ts";

import "@/app/globals.css";

// Per owner, or all four sites share the umbrella's tab title and description —
// which is the opposite of the point.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const owner = await requireOwner(params);

  const site = await getSite(owner.key);

  return {
    // Every relative URL in metadata (Open Graph, canonical) resolves against
    // the owner's own host, not whichever host built the page.
    metadataBase: new URL(ownerUrl(owner)),
    title: { default: owner.name, template: `%s · ${owner.name}` },
    description: site.tagline,
  };
}

// The root layout sits inside the segment so that `data-owner` can go on
// <html>. It has to be that high: a dialog or a menu portals into
// document.body, so a wrapper further down the tree would leave them on shared
// teal, and globals.css matches the dark blocks same-element as
// `.dark[data-owner="smp"]`, where the theme class also lives.
//
// Being here also keeps the owner a route parameter rather than a header read,
// so it stays part of every cache key. Next's not-found boundary sits above
// this layout, so an unclaimed path is answered by `app/global-not-found.tsx`
// instead, which reads the owner from the Host header on its own and builds the
// same shell from `shell.tsx`.
//
// `params` is typed as a plain string because that is what Next generates for
// the segment. Paths the proxy matcher skips arrive with that path as the owner
// key, so `requireOwner` narrows it here and again in every page, which can
// render before the layout's check has finished.
export default async function OwnerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ owner: string }>;
}) {
  const owner = await requireOwner(params);

  const site = await getSite(owner.key);

  return (
    // `suppressHydrationWarning` because the theme script below sets a class on
    // this element before React hydrates. It suppresses one level only, which
    // is exactly the element the script touches.
    <html lang="id" data-owner={owner.key} className={jakarta.variable} suppressHydrationWarning>
      <body>
        <ThemeScript />
        <JsonLd data={siteLd(owner, site)} />
        <Header owner={owner} site={site} />
        {children}
        <Footer owner={owner} site={site} />
        <LinkStatus />
      </body>
    </html>
  );
}

/** The owner as a search result describes it: address, map pin, phone and accounts. */
function siteLd(owner: Owner, site: Site) {
  // Free text in the CMS, so a pin is sent only when it reads as two numbers.
  const pin = site.mapsCoordinates?.split(",").map(Number) ?? [];
  const [latitude, longitude] = pin.length === 2 && pin.every(Number.isFinite) ? pin : [];
  return {
    ...organizationOf(owner),
    description: site.tagline,
    ...(site.logo ? { logo: mediaUrl(site.logo) } : {}),
    ...(site.address ? { address: site.address } : {}),
    ...(latitude !== undefined && longitude !== undefined
      ? { geo: { "@type": "GeoCoordinates", latitude, longitude } }
      : {}),
    ...(site.headerPhone?.href.startsWith("tel:")
      ? { telephone: site.headerPhone.href.slice("tel:".length) }
      : {}),
    ...(site.socials.length > 0 ? { sameAs: site.socials.map((social) => social.href) } : {}),
  };
}

/**
 * Required, not leftover. Compile mode prerenders nothing, so this enumerates
 * nothing — but `owner` is a root parameter, and Next refuses to build without
 * a `generateStaticParams` for one: "A required root parameter (owner) was not
 * provided in generateStaticParams". Deleting it fails the build; it has been
 * tried.
 */
export function generateStaticParams() {
  return OWNERS.map((owner) => ({ owner: owner.key }));
}
