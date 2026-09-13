"use client";

import { Button } from "@mbs/ui/components/button";

import { OWNERS, type Owner } from "../owners.ts";
import { Exception } from "./exception.tsx";

import "./globals.css";

/**
 * The root layout itself failed.
 *
 * That is the case `[owner]/error.tsx` cannot cover: its boundary lives inside
 * the layout, so a layout that throws takes the boundary with it. The one that
 * actually happens is the CMS being unreachable on a cache miss.
 *
 * It carries a reduced shell rather than the real one, and that is the whole
 * point: the header and footer are built from the owner's `Site` row, and a
 * failed read of exactly that row is what brings a visitor here. A shell that
 * needs the CMS cannot be the shell that survives the CMS being down. So the
 * identity comes from `owners.ts`, which is a compile-time constant, and the
 * links are fixed routes. No switcher: its links are absolute and cross-host,
 * built from `PROFILE_APEX`, which is not inlined into a client bundle — every
 * tab would point at production from a development machine.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // `^www.` is stripped for the same reason the proxy strips it: the owner is
  // the label after it, and without this a `www.` visitor gets the umbrella's
  // identity and palette on their school's error page.
  const label = globalThis.location?.hostname.replace(/^www\./, "").split(".")[0];
  const owner: Owner | null = OWNERS.find((candidate) => candidate.subdomain === label) ?? null;
  const name = owner?.name ?? "Madina Boarding School";

  return (
    <html lang="id" data-owner={owner?.key ?? "mbs"}>
      <body>
        <header className="border-b border-border px-4 md:px-12 lg:px-30">
          <a href="/" className="flex items-center gap-3 py-3">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[10px] font-semibold text-muted-foreground md:size-9.5 lg:size-10"
            >
              LOGO
            </span>
            <span className="text-sm font-bold md:text-base">{name}</span>
          </a>
        </header>

        <Exception
          kind="error"
          code="Gangguan sementara"
          title="Situs ini sedang tidak bisa ditampilkan"
          body="Bukan kesalahan Anda. Coba muat ulang halaman ini; bila masih sama, hubungi panitia dengan kode di bawah."
          owner={owner}
          action={
            <Button size="touch" onClick={() => globalThis.location.reload()}>
              Muat ulang
            </Button>
          }
          reference={error.digest}
        />

        <footer className="border-t border-border bg-muted px-4 py-4 text-xs text-muted-foreground md:px-12 lg:px-30">
          {name}
        </footer>
      </body>
    </html>
  );
}
