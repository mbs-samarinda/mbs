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
