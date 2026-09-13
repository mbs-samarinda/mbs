import type { Metadata } from "next";
import { headers } from "next/headers";

import { ownerFromHostname } from "../owners.ts";

import "./globals.css";

// The root layout lives inside `[owner]`, so an unclaimed path has no layout to
// render a `not-found.tsx` in. This convention answers from outside the tree
// with a full document of its own, which is why it repeats `<html>`, the
// stylesheet and `data-owner` instead of inheriting them.
//
// The owner has to come from the Host header here: there is no `params`
// outside the segment. Reading a header makes this one route dynamic, which
// `instant = false` allows; the owner pages keep their own layout and stay
// static. The proxy refuses an unknown host before anything renders, so the
// owner is only ever null for a path its matcher skips.
export const instant = false;

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

export default async function GlobalNotFound() {
  const owner = ownerFromHostname((await headers()).get("host") ?? "");

  return (
    <html lang="id" data-owner={owner?.key}>
      <body>
        <main className="mx-auto max-w-3xl p-8">
          <h1 className="text-3xl font-semibold">Halaman tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Alamat ini tidak ada.{" "}
            <a href="/" className="underline">
              Ke beranda
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
