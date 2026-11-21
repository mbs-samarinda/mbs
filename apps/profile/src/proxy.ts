import { NextResponse, type NextRequest } from "next/server";

import { config as env } from "./config/env.ts";
import {
  admissionUrl,
  isUmbrella,
  ownerFromHostname,
  ownerHost,
  ownerLacksPath,
} from "./owners.ts";
import { cookieOptions, DRAFT_COOKIE, isValidSession, nowS, PREVIEW_COOKIE } from "./preview.ts";

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
 * /sma/foo internally, and the apex home becomes /mbs. The owner key is then
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

  // The apex has no admission page. Its own buttons link to the admission app
  // directly, so this catches a typed or shared `/pendaftaran` address.
  // 307, not 308: where the joint campaign lives is a choice that may change.
  if (isUmbrella(owner) && pathname === "/pendaftaran") {
    return NextResponse.redirect(`${admissionUrl()}${request.nextUrl.search}`, 307);
  }

  const url = request.nextUrl.clone();
  url.pathname = ownerLacksPath(owner, pathname)
    ? `/${owner.key}${UNCLAIMED}`
    : `/${owner.key}${pathname}`;

  // A Draft Mode cookie with no valid school cookie beside it is dropped before
  // the page sees it: copied from another school's site, outlived its preview,
  // or left over after `PREVIEW_SECRET` was unset (`preview.ts`).
  const hasDraftCookie = request.cookies.has(DRAFT_COOKIE);
  const secret = env.previewSecret;
  const previewing =
    hasDraftCookie &&
    secret !== undefined &&
    isValidSession(secret, owner.key, request.cookies.get(PREVIEW_COOKIE)?.value, nowS());

  let response: NextResponse;
  if (hasDraftCookie && !previewing) {
    request.cookies.delete(DRAFT_COOKIE);
    response = NextResponse.rewrite(url, { request: { headers: request.headers } });
    // Same attributes as when set, or a browser inside the CMS frame ignores the removal.
    response.cookies.set(DRAFT_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    response.cookies.set(PREVIEW_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  } else {
    response = NextResponse.rewrite(url);
  }
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return response;
}

/**
 * A baseline, not a script allow-list. A strict `script-src` needs a nonce on
 * every one of Next's inline scripts, which ties every page to per-request
 * rendering for good; editors cannot inject a script anyway (`prose.tsx`).
 *
 * Only our own CMS admin may frame the site, for its Preview pane. On every
 * page, not just in preview: the pane's "Published" tab and the banner's exit
 * both show the page as visitors see it, still inside the frame.
 *
 * Set here rather than in `next.config.ts`, whose headers are fixed when the
 * image is built, while the CMS host is only known at runtime.
 */
export function contentSecurityPolicy(): string {
  const ancestors = env.cmsHost ?? "'none'";
  return `object-src 'none'; base-uri 'self'; frame-ancestors ${ancestors}; form-action 'self'`;
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
