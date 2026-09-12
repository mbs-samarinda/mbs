import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OWNERS } from "../../owners.ts";

import "../globals.css";

export const metadata: Metadata = {
  title: "MBSS",
  description: "Madina Boarding School Samarinda",
};

// The root layout sits inside the segment so that `data-owner` can go on
// <html>. It has to be that high: a dialog or a menu portals into
// document.body, so a wrapper further down the tree would leave them on shared
// teal, and globals.css matches the dark blocks same-element as
// `.dark[data-owner="smp"]`, where the theme class also lives.
//
// Being here keeps every owner page prerenderable, which reading the owner from
// a header in a layout above would not. The cost is the 404: Next's not-found
// boundary sits above the root layout, so an unclaimed path answers with Next's
// own document — right status, no stylesheet, no owner. A `not-found.tsx` in
// this segment does not claim it, nor does one beside a `[...rest]` catch-all
// that calls `notFound()`; both were built and measured against a running
// server, and both still returned `<html id="__next_error__">`.
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
