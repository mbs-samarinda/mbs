import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import { SearchXIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Owner } from "../owners.ts";

/**
 * The page a visitor lands on when the address is wrong or something broke.
 *
 * One component for three surfaces — the 404, an error inside a page, and an
 * error in the root layout itself — because they are one design: a code, a
 * sentence naming the owner, what to do next, and the handful of addresses
 * people actually want. Only the words and the icon differ.
 *
 * The suggested links are routes, not editor content, and are deliberately not
 * read from the CMS: two of these three surfaces exist precisely for when that
 * read is what failed.
 */

const SCHOOL_LINKS = [
  { label: "Pendaftaran", href: "/pendaftaran" },
  { label: "Program", href: "/program" },
  { label: "Berita & Pengumuman", href: "/berita" },
  { label: "Kontak", href: "/kontak" },
];

// The umbrella carries no `program`; a visitor there is choosing a school.
const UMBRELLA_LINKS = [
  { label: "Pendaftaran Bersama", href: "/pendaftaran" },
  { label: "Profil", href: "/profil" },
  { label: "Berita & Pengumuman", href: "/berita" },
  { label: "Kontak", href: "/kontak" },
];

export function Exception({
  kind,
  code,
  title,
  body,
  owner,
  action,
  reference,
}: {
  kind: "not-found" | "error";
  code: string;
  title: string;
  body: string;
  owner: Owner | null;
  /** The retry control, when the failure is one a retry can clear. */
  action?: ReactNode | undefined;
  /** The digest, so a report can be matched to a server log line. */
  reference?: string | undefined;
}) {
  const Icon = kind === "not-found" ? SearchXIcon : TriangleAlertIcon;
  const links = owner && owner.key !== "mbs" ? SCHOOL_LINKS : UMBRELLA_LINKS;

  return (
    <main className="mx-auto flex w-full max-w-300 flex-col gap-8 px-4 py-16 md:px-12 md:py-20 lg:px-30 lg:py-24">
      <div className="flex flex-col gap-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <Icon aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.75} />
        </span>
        {/* The code is a word as often as a number, and never the only signal:
            the sentence below says the same thing in full. */}
        <p className="text-[13px] font-bold tracking-wide text-muted-foreground uppercase">
          {code}
        </p>
        <h1 className="max-w-[20ch] text-[32px] leading-tight font-extrabold text-balance md:text-[40px]">
          {title}
        </h1>
        <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{body}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {action}
        <a href="/" className={buttonVariants({ size: "touch" })}>
          Kembali ke Beranda
        </a>
        <a href="/kontak" className={cn(buttonVariants({ variant: "outline", size: "touch" }))}>
          Hubungi Panitia
        </a>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Halaman yang mungkin Anda cari
        </h2>
        <nav aria-label="Halaman" className="flex flex-wrap gap-x-7 gap-y-1">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      {reference && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Ref: {reference}. Sebutkan kode ini bila Anda menghubungi panitia.
        </p>
      )}
    </main>
  );
}
