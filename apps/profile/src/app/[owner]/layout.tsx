import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OWNERS } from "../../owners.ts";

import "../globals.css";

export const metadata: Metadata = {
  title: "MBSS",
  description: "Madina Boarding School Samarinda",
};

// The root layout sits inside the segment on purpose. Middleware rewrites every
// path to /[owner]/..., so nothing routes above this, and being here is what
// lets `data-owner` go on <html> — the palette then reaches portalled content
// (dialogs, menus) that a wrapper element inside the tree would miss.
//
// `params` is typed as a plain string because that is what Next generates for
// the segment; the key is narrowed here rather than asserted, so an owner that
// middleware would never produce cannot reach the attribute either.
//
// The cost of living here: Next's not-found boundary sits above this layout, so
// a 404 renders its own bare document with no stylesheet and no lang. A
// `not-found.tsx` inside the segment does not claim it — verified against the
// running build. Unresolved; see PRODUCT.md.
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
