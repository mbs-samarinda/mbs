import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OWNERS, ownerHost, ownerUrl, type Owner } from "../../owners.ts";
import { SITE_CONTENT, type SiteContent } from "../../site-content.ts";
import { MobileMenu } from "./mobile-menu.tsx";
import { NavScroller } from "./nav-scroller.tsx";

import "../globals.css";

// The page gutter, one value for the whole shell: 16px on a phone, 48px at
// tablet, 120px on a desktop page.
const GUTTER = "px-4 md:px-12 lg:px-30";

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

// No approved vector exists for any owner, so the mark is a labelled slot rather
// than a wordmark set in the body typeface. It is hidden from assistive
// technology because the owner's name sits beside it in text.
function LogoSlot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center rounded-lg border border-border bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
    >
      LOGO
    </span>
  );
}

/**
 * The switcher, brand, navigation and admission action.
 *
 * One component covers all three widths, because they are one layout with
 * different wrapping, not three designs: the main bar wraps, and `order` moves
 * the navigation between its own row at tablet and the brand's row on a desktop
 * page. Below `md` the navigation moves into a sheet, and the admission action
 * goes with it so the bar holds the identity alone.
 */
function Header({ owner, content }: { owner: Owner; content: SiteContent }) {
  return (
    // Both rows stay put while the page scrolls: the switcher says which site
    // you are on and the bar carries the admission action, and neither is worth
    // scrolling back up for. z-40 leaves the layers above it free for the
    // sheet, which portals to the body and sits at z-50.
    <header className="sticky top-0 z-40 bg-background">
      <div
        className={`flex items-center justify-between gap-4 border-b border-border bg-muted ${GUTTER}`}
      >
        <nav aria-label="Situs MBSS" className="flex items-center gap-0.5">
          {OWNERS.map((candidate) => {
            const current = candidate.key === owner.key;
            return (
              <a
                key={candidate.key}
                href={ownerUrl(candidate)}
                // "true", not "page": the tab marks the current site, and its
                // link goes to that site's home rather than to this page.
                aria-current={current ? "true" : undefined}
                // 44px on a phone, where it is a target under a thumb. The
                // canvas draws 32; the house rule for parent-facing surfaces
                // wins. From `md` up it is a pointer target and follows the
                // canvas again.
                className={`flex h-11 items-center px-2.5 text-xs md:h-9 md:px-3 ${current ? "bg-background font-semibold text-primary" : "font-medium text-muted-foreground hover:text-foreground"}`}
              >
                {candidate.level}
              </a>
            );
          })}
        </nav>
        {/* A school puts the two numbers a parent actually asks on up here. The
            umbrella has no panitia of its own, so it names the foundation
            instead — which is content on the umbrella, never its identity. */}
        {content.headerContact ? (
          <p className="hidden items-center gap-4 text-xs md:flex">
            <a href={content.headerContact.phone.href} className="text-muted-foreground">
              {content.headerContact.phone.label}
            </a>
            <a href={content.headerContact.whatsapp.href} className="font-semibold text-primary">
              {content.headerContact.whatsapp.label}
            </a>
          </p>
        ) : (
          <p className="hidden text-xs text-muted-foreground md:block">{content.legal}</p>
        )}
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 border-b border-border lg:flex-nowrap ${GUTTER}`}
      >
        {/* The identity never wraps: a school's name broken over two lines
            changes the height of the bar and reads as two names. */}
        <a href="/" className="flex shrink-0 items-center gap-3 py-3 lg:order-1">
          <LogoSlot className="size-8 shrink-0 md:size-9.5 lg:size-10" />
          <span className="flex flex-col gap-0.5 whitespace-nowrap">
            <span className="text-sm font-bold md:text-base">{owner.name}</span>
            <span className="text-[11px] text-muted-foreground">{content.brandSubline}</span>
          </span>
        </a>

        <MobileMenu items={content.nav} owner={owner.name} admissionCta={content.admissionCta} />

        <NavScroller
          items={content.nav}
          // The tablet row is its own 44px-tall band, so an arrow sitting over
          // it has somewhere to be. On a desktop page the row is inline and the
          // 76px main bar gives the arrow its height instead. No rule between
          // the two rows: they are one header, and the bar's own bottom border
          // already closes it.
          className="order-3 hidden w-full py-3 md:flex lg:order-2 lg:w-auto lg:min-w-0 lg:flex-1 lg:py-0"
        />

        <a
          href="/pendaftaran"
          className={cn(
            buttonVariants({ size: "touch" }),
            "order-2 hidden shrink-0 md:inline-flex lg:order-3",
          )}
        >
          {content.admissionCta}
        </a>
      </div>
    </header>
  );
}

/**
 * Identity, the two link columns, and the ways to ask.
 *
 * The contact column comes first on a phone and sits last from tablet up: asking
 * is the primary action here, and on a phone that means it is not below four
 * screens of links. `lg:contents` drops the grouping wrapper on a desktop page
 * so all four blocks share the one row.
 */
function Footer({ owner, content }: { owner: Owner; content: SiteContent }) {
  return (
    <footer className="border-t border-border bg-background">
      <div
        className={`flex flex-col gap-7 py-8 md:py-10 lg:flex-row lg:justify-between lg:gap-16 lg:py-14 ${GUTTER}`}
      >
        <div className="flex flex-col gap-2.5 lg:max-w-85">
          <div className="flex items-center gap-2.5">
            <LogoSlot className="size-9 shrink-0" />
            <span className="text-[15px] font-bold">{owner.name}</span>
          </div>
          {content.tagline && (
            <p className="text-sm font-semibold text-primary">{content.tagline}</p>
          )}
          <p className="text-sm text-muted-foreground">{content.address}</p>
          {content.hours && <p className="text-sm text-muted-foreground">{content.hours}</p>}
        </div>

        <div className="flex flex-col gap-7 md:flex-row md:gap-8 lg:contents">
          {content.footerColumns.map((column) => (
            <nav
              key={column.heading}
              aria-label={column.heading}
              className="flex flex-col gap-2.5 md:flex-1"
            >
              <h2 className="text-xs font-bold">{column.heading}</h2>
              {column.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground md:min-h-0"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          ))}

          <div className="order-first flex flex-col gap-2.5 md:order-none md:flex-1">
            <h2 className="text-xs font-bold">Hubungi</h2>
            {content.contacts.map((contact) => (
              <a
                key={contact.href}
                href={contact.href}
                className="flex min-h-11 flex-col justify-center gap-0.5"
              >
                <span className="text-[13px] font-semibold text-primary">{contact.label}</span>
                <span className="text-[13px] text-muted-foreground">{contact.value}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`flex flex-col gap-1 border-t border-border bg-muted py-4 text-xs text-muted-foreground md:h-14 md:flex-row md:items-center md:justify-between md:py-0 ${GUTTER}`}
      >
        <p>{content.copyright}</p>
        <p>{content.legal}</p>
      </div>
    </footer>
  );
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

  const content = SITE_CONTENT[owner.key];

  return (
    <html lang="id" data-owner={owner.key}>
      <body>
        <Header owner={owner} content={content} />
        {children}
        <Footer owner={owner} content={content} />
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return OWNERS.map((owner) => ({ owner: owner.key }));
}
