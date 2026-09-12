import { NextResponse, type NextRequest } from "next/server";

import { ownerFromHostname, OWNER_HEADER } from "./owners.ts";

/**
 * Turns the hostname into a route segment: sma.mbss.sch.id/foo becomes
 * /sma/foo internally, and the apex becomes /mbs/foo. The owner key is then
 * part of every cache key, so two owners can never share a cached page for the
 * same path.
 */
export function middleware(request: NextRequest) {
  const owner = ownerFromHostname(request.headers.get("host") ?? "");
  if (!owner) return new NextResponse("Unknown owner host", { status: 404 });

  const url = request.nextUrl.clone();
  url.pathname = `/${owner.key}${request.nextUrl.pathname}`;

  const headers = new Headers(request.headers);
  headers.set(OWNER_HEADER, owner.key);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico$).*)"],
};
