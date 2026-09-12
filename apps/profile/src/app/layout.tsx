import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { OWNER_HEADER, OWNERS } from "../owners.ts";

import "./globals.css";

// Cache Components will not prerender a route whose shell reads a header, and
// the owner attribute is in the shell by design. This opts every route into
// blocking render rather than hiding the read behind a Suspense boundary that
// <html> cannot have.
export const instant = false;

export const metadata: Metadata = {
  title: "MBSS",
  description: "Madina Boarding School Samarinda",
};

// `data-owner` goes on <html>, not on a wrapper inside the tree: a dialog or a
// menu portals into document.body, so only an ancestor that high hands it the
// owner's palette. It has to stay on <html> — globals.css matches the dark
// blocks as `.dark[data-owner="smp"]`, same element, and the theme class goes
// there too. A root layout has no params, so the owner arrives as a header
// middleware sets while resolving the hostname.
//
// The cost is that reading a header makes this layout dynamic, so no page
// prerenders as static any more. The alternative — a root layout inside the
// [owner] segment — kept the static shell but left Next's not-found boundary
// above it, which meant 404s came out with no stylesheet at all.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const key = (await headers()).get(OWNER_HEADER);
  const owner = OWNERS.find((candidate) => candidate.key === key);

  return (
    // No owner means a request that did not come through middleware. It still
    // gets the shared palette rather than an unstyled page.
    <html lang="id" {...(owner ? { "data-owner": owner.key } : {})}>
      <body>{children}</body>
    </html>
  );
}
