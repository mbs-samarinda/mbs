import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OWNERS, ownerHost } from "../../owners.ts";

import "../globals.css";

// Per owner, or all four sites share the umbrella's tab title and description —
// which is the opposite of the point. The description is a placeholder until the
// CMS owns SEO defaults; it says what the site is and nothing more.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return { title: "MBSS" };

  return {
    // Every relative URL in metadata (Open Graph, canonical) resolves against
    // the owner's own host, not whichever host built the page.
    metadataBase: new URL(`https://${ownerHost(owner)}`),
    title: owner.name,
    description: `Situs resmi ${owner.name}.`,
  };
}

// The root layout sits inside the segment so that `data-owner` can go on
// <html>. It has to be that high: a dialog or a menu portals into
// document.body, so a wrapper further down the tree would leave them on shared
// teal, and globals.css matches the dark blocks same-element as
// `.dark[data-owner="smp"]`, where the theme class also lives.
//
// Being here keeps every owner page prerenderable, which reading the owner from
// a header in a layout above would not. Next's not-found boundary sits above
// this layout, so an unclaimed path is answered by `app/global-not-found.tsx`
// instead, which reads the owner from the Host header on its own.
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

  return (
    <html lang="id" data-owner={owner.key}>
      <body>{children}</body>
    </html>
  );
}

export function generateStaticParams() {
  return OWNERS.map((owner) => ({ owner: owner.key }));
}
