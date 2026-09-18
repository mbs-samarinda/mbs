import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getSite } from "../../cms.ts";
import { OWNERS, ownerHost } from "../../owners.ts";
import { Footer, Header } from "./shell.tsx";
import { ThemeScript } from "./theme-script.tsx";

import "../globals.css";

// Per owner, or all four sites share the umbrella's tab title and description —
// which is the opposite of the point.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return { title: "MBSS" };

  const site = await getSite(owner.key);

  return {
    // Every relative URL in metadata (Open Graph, canonical) resolves against
    // the owner's own host, not whichever host built the page.
    metadataBase: new URL(`https://${ownerHost(owner)}`),
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
// the segment. Narrowing it here is the segment's only guard: paths the proxy
// matcher skips arrive with that path as the owner key, and without this they
// would serve the first owner's content under another owner's hostname.
export default async function OwnerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ owner: string }>;
}) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const site = await getSite(owner.key);

  return (
    // `suppressHydrationWarning` because the theme script below sets a class on
    // this element before React hydrates. It suppresses one level only, which
    // is exactly the element the script touches.
    <html lang="id" data-owner={owner.key} suppressHydrationWarning>
      <body>
        <ThemeScript />
        <Header owner={owner} site={site} />
        {children}
        <Footer owner={owner} site={site} />
      </body>
    </html>
  );
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
