import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { OWNER_HEADER } from "../middleware.ts";
import { OWNERS } from "../owners.ts";

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

// `data-owner` belongs on <body> rather than on a wrapper inside it: a dialog or
// a menu portals into document.body, so only an ancestor that high hands it the
// owner's palette. <body> is rendered here, and a root layout has no params, so
// the owner arrives as a header middleware set while resolving the hostname.
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
