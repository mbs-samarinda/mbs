import type { Metadata } from "next";
import { headers } from "next/headers";

import { getSite, type Site } from "../cms.ts";
import { ownerFromHostname, type Owner } from "../owners.ts";
import { Footer, Header } from "./[owner]/shell.tsx";
import { ThemeScript } from "./[owner]/theme-script.tsx";
import { Exception } from "./exception.tsx";

import "./globals.css";

// The root layout lives inside `[owner]`, so an unclaimed path has no layout to
// render a `not-found.tsx` in. This convention answers from outside the tree
// with a full document of its own, which is why it repeats `<html>`, the
// stylesheet, the theme script and `data-owner` instead of inheriting them —
// and why it builds the shell itself from `shell.tsx`.
//
// The owner has to come from the Host header here: there is no `params`
// outside the segment. Reading a header makes this one route dynamic, which
// `instant = false` allows; the owner pages keep their own layout and stay
// static. The proxy refuses an unknown host before anything renders, so the
// owner is only ever null for a path its matcher skips.
export const instant = false;

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

/**
 * The shell needs the owner's `Site` row, and this page must render even when
 * that read is what failed — a 404 that 500s tells a visitor nothing and loses
 * the navigation that is the whole point of the page. So the shell is best
 * effort: present when the CMS answers, absent when it does not, and the
 * exception itself never depends on it.
 */
async function loadSite(owner: Owner | null): Promise<Site | null> {
  if (!owner) return null;
  try {
    return await getSite(owner.key);
  } catch {
    return null;
  }
}

export default async function GlobalNotFound() {
  const owner = ownerFromHostname((await headers()).get("host") ?? "");
  const site = await loadSite(owner);

  return (
    <html lang="id" data-owner={owner?.key} suppressHydrationWarning>
      <body>
        <ThemeScript />
        {owner && site && <Header owner={owner} site={site} />}
        <Exception
          kind="not-found"
          code="404"
          title={owner ? `Halaman ini tidak ada di situs ${owner.name}` : "Halaman ini tidak ada"}
          body="Tautannya mungkin sudah berubah. Coba mulai dari beranda, atau tanyakan langsung kepada panitia."
          owner={owner}
        />
        {owner && site && <Footer owner={owner} site={site} />}
      </body>
    </html>
  );
}
