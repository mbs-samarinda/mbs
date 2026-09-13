import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import Image from "next/image";

import { mediaUrl, type Site } from "../../cms.ts";
import { OWNERS, ownerUrl, type Owner } from "../../owners.ts";
import { MobileMenu } from "./mobile-menu.tsx";
import { NavScroller } from "./nav-scroller.tsx";
import { COOKIE_SUFFIX } from "./theme-script.tsx";
import { ThemeSelect } from "./theme.tsx";

/**
 * The header and footer every page wears.
 *
 * They live here rather than inside the layout because two trees need them: the
 * owner pages, and `global-not-found.tsx`, which renders outside the layout as
 * a document of its own. A 404 without navigation and a way to ask is a dead
 * end, and the page map requires neither to be reachable only from a working
 * page.
 */

// The page gutter, one value for the whole shell: 16px on a phone, 48px at
// tablet, 120px on a desktop page.
const GUTTER = "px-4 md:px-12 lg:px-30";

// No approved vector exists for any owner yet, so the mark falls back to a
// labelled slot rather than a wordmark set in the body typeface. It is hidden
// from assistive technology because the owner's name sits beside it in text.
function LogoSlot({ logo, className }: { logo: Site["logo"]; className: string }) {
  if (logo) {
    return (
      <Image
        aria-hidden
        src={mediaUrl(logo)}
        alt=""
        width={logo.width}
        height={logo.height}
        className={`object-contain ${className}`}
      />
    );
  }

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
export function Header({ owner, site }: { owner: Owner; site: Site }) {
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
        {site.headerPhone && site.headerWhatsapp ? (
          <p className="hidden items-center gap-4 text-xs md:flex">
            <a href={site.headerPhone.href} className="text-muted-foreground">
              {site.headerPhone.label}
            </a>
            <a href={site.headerWhatsapp.href} className="font-semibold text-primary">
              {site.headerWhatsapp.label}
            </a>
          </p>
        ) : (
          site.legal && (
            <p className="hidden text-xs text-muted-foreground md:block">{site.legal}</p>
          )
        )}
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 border-b border-border lg:flex-nowrap ${GUTTER}`}
      >
        {/* The identity never wraps: a school's name broken over two lines
            changes the height of the bar and reads as two names. */}
        <a href="/" className="flex shrink-0 items-center gap-3 py-3 lg:order-1">
          <LogoSlot logo={site.logo} className="size-8 shrink-0 md:size-9.5 lg:size-10" />
          <span className="flex flex-col gap-0.5 whitespace-nowrap">
            <span className="text-sm font-bold md:text-base">{owner.name}</span>
            {site.brandSubline && (
              <span className="text-[11px] text-muted-foreground">{site.brandSubline}</span>
            )}
          </span>
        </a>

        <MobileMenu
          items={site.navigation}
          owner={owner.name}
          admissionCta={site.admissionCta}
          cookieSuffix={COOKIE_SUFFIX}
        />

        <NavScroller
          items={site.navigation}
          // The tablet row is its own 44px-tall band, so an arrow sitting over
          // it has somewhere to be. On a desktop page the row is inline and the
          // 76px main bar gives the arrow its height instead. No rule between
          // the two rows: they are one header, and the bar's own bottom border
          // already closes it.
          className="order-3 hidden w-full py-3 md:flex lg:order-2 lg:w-auto lg:min-w-0 lg:flex-1 lg:py-0"
        />

        {/* The wrapper itself is hidden below `md`, not just its children: an
            empty flex item still takes a slot, and `justify-between` would hand
            it the right-hand end — leaving the menu button stranded in the
            middle of the bar. */}
        <div className="order-2 hidden shrink-0 items-center gap-2 md:flex lg:order-3">
          <ThemeSelect cookieSuffix={COOKIE_SUFFIX} />
          <a href="/pendaftaran" className={cn(buttonVariants({ size: "touch" }), "shrink-0")}>
            {site.admissionCta}
          </a>
        </div>
      </div>
    </header>
  );
}

/**
 * Identity, the link columns, and the ways to ask.
 *
 * The contact column comes first on a phone and sits last from tablet up: asking
 * is the primary action here, and on a phone that means it is not below four
 * screens of links. `lg:contents` drops the grouping wrapper on a desktop page
 * so all four blocks share the one row.
 */
export function Footer({ owner, site }: { owner: Owner; site: Site }) {
  // The links from the apex to the three school sites cross hostnames, so they
  // are built here from the domain this deploy was made under, not typed into
  // the CMS where they would be a production URL on every staging page.
  const columns =
    owner.key === "mbs"
      ? [
          {
            heading: "Sekolah",
            links: OWNERS.filter((candidate) => candidate.subdomain).map((school) => ({
              label: school.name,
              href: ownerUrl(school),
            })),
          },
          ...site.footerColumns,
        ]
      : site.footerColumns;

  return (
    <footer className="border-t border-border bg-background">
      <div
        className={`flex flex-col gap-7 py-8 md:py-10 lg:flex-row lg:justify-between lg:gap-16 lg:py-14 ${GUTTER}`}
      >
        <div className="flex flex-col gap-2.5 lg:max-w-85">
          <div className="flex items-center gap-2.5">
            <LogoSlot logo={site.logo} className="size-9 shrink-0" />
            <span className="text-[15px] font-bold">{owner.name}</span>
          </div>
          <p className="text-sm font-semibold text-primary">{site.tagline}</p>
          {site.address && <p className="text-sm text-muted-foreground">{site.address}</p>}
          {site.hours && <p className="text-sm text-muted-foreground">{site.hours}</p>}
        </div>

        <div className="flex flex-col gap-7 md:flex-row md:gap-8 lg:contents">
          {columns.map((column) => (
            <nav
              key={column.heading}
              aria-label={column.heading}
              className="flex flex-col gap-2.5 md:flex-1"
            >
              <h2 className="text-xs font-bold">{column.heading}</h2>
              {column.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground md:min-h-0"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ))}

          <div className="order-first flex flex-col gap-2.5 md:order-none md:flex-1">
            <h2 className="text-xs font-bold">Hubungi</h2>
            {site.contacts.map((contact) => (
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
        {site.copyright && <p>{site.copyright}</p>}
        {site.legal && <p>{site.legal}</p>}
      </div>
    </footer>
  );
}
