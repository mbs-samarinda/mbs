import { schoolFromHostname } from "@mbs/school-config";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Turns the hostname into a route segment: sma.mbss.sch.id/foo becomes
 * /sma/foo internally. The school key is then part of every cache key, so two
 * schools can never share a cached page for the same path.
 */
export function middleware(request: NextRequest) {
  const school = schoolFromHostname(request.headers.get("host") ?? "");
  if (!school) return new NextResponse("Unknown school host", { status: 404 });

  const url = request.nextUrl.clone();
  url.pathname = `/${school.key}${request.nextUrl.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
