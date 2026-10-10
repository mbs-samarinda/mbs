import type { CmsLink, Site } from "../../cms.ts";

/**
 * One navigation link's look, shared by the desktop row and the phone menu so
 * the two cannot drift apart on the next hover or colour change.
 *
 * It lives in a module of its own rather than beside either consumer: the row
 * is a client component, and every export of a client module is a reference
 * proxy on the server, so a server component reading the constant from there
 * gets a throwing function stringified into the class attribute — silently,
 * with a green build.
 *
 * No current-page state: marking one would mean reading the pathname on the
 * client, which `cacheComponents` turns into a dynamic hole in every page —
 * paid for a page that does not exist, since home is the only route built. The
 * switcher tab already says which site you are on. It comes back with the
 * second page, where it can be tested.
 */
export const NAV_LINK = "text-sm font-medium text-foreground transition-colors hover:text-primary";

/** One menu entry, decided once in the header so the row and the sheet cannot disagree. */
export type MenuEntry =
  | { readonly label: string; readonly href: string }
  | {
      readonly label: string;
      /** Where the item itself points, listed first and set apart. */
      readonly overview: CmsLink | null;
      readonly links: readonly CmsLink[];
    };

/**
 * `Site.menu` as the header draws it.
 *
 * An item with child links is a group. Its own address is never lost: the child
 * that repeats it becomes the overview, or one is made from the item's label
 * when an editor removed it. An item with neither links nor an address is
 * dropped, since it would lead nowhere.
 */
/** A React key from editor text: only an exact repeat of the same entry collides. */
export const menuKey = (entry: MenuEntry | CmsLink) =>
  `${entry.label} ${"href" in entry ? entry.href : (entry.overview?.href ?? "")}`;

export const toMenu = (menu: Site["menu"]): MenuEntry[] =>
  menu.flatMap(({ label, href, links }): MenuEntry[] => {
    if (links.length === 0) return href ? [{ label, href }] : [];
    const overview = href ? (links.find((link) => link.href === href) ?? { label, href }) : null;
    return [{ label, overview, links: links.filter((link) => link.href !== href) }];
  });
