import { NextResponse, type NextRequest } from "next/server";

import { ownerFromHostname, ownerHost, ownerLacksPath } from "./owners.ts";

/**
 * Where a path its owner has no page for is sent, so that `global-not-found.tsx`
 * answers it rather than Next's built-in 404. Nothing claims it, which is the
 * whole requirement — `global-not-found` is reached by not matching a route, not
 * by a page calling `notFound()`. Reserved-looking on purpose: a slug an editor
 * could type must never collide with it.
 */
const UNCLAIMED = "/__not-found";

/**
 * Turns the hostname into a route segment: sma.mbss.sch.id/foo becomes
 * /sma/foo internally, and the apex becomes /mbs/foo. The owner key is then
 * part of every cache key, so two owners can never share a cached page for the
 * same path.
 *
 * A `www.` host resolves to the same owner but redirects to the bare host
 * first, so every page has one URL and crawlers never see it twice.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const owner = ownerFromHostname(host);
  if (!owner) return new NextResponse("Unknown owner host", { status: 404 });

  if (/^www\./i.test(host)) {
    // Built from scratch rather than by editing `nextUrl`: that carries the
    // port Next listens on behind the reverse proxy, which is not public.
    const { pathname, search } = request.nextUrl;
    return NextResponse.redirect(`https://${ownerHost(owner)}${pathname}${search}`, 308);
  }

  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = ownerLacksPath(owner, pathname)
    ? `/${owner.key}${UNCLAIMED}`
    : `/${owner.key}${pathname}`;
  return NextResponse.rewrite(url);
}

// `/favicon.ico` is rewritten too: each owner keeps its own icon under
// `public/<owner>/`, so the browser's default request lands on that file
// instead of reaching the `[owner]` route with `favicon.ico` as the key.
//
// `api/` is excluded because those routes belong to no owner. The revalidate
// endpoint is called by the CMS, not by a visitor, and rewriting it would bury
// it under `/[owner]/api/...` where no route answers.
export const config = {
  matcher: ["/((?!_next/|api/).*)"],
};
