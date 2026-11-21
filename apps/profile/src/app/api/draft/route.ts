import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";

import { config } from "@/config/env.ts";
import { ownerFromHostname } from "@/owners.ts";
import { cookieOptions, nowS, PREVIEW_COOKIE, sessionValue, verifyLink } from "@/preview.ts";

/**
 * Where Strapi's Preview button lands: checks the signed link, turns Draft
 * Mode on (or off, for the "Published" tab), and sends the editor to the page.
 *
 * GET, though it changes state, because the CMS opens it as a plain link in a
 * frame or tab. The signature is what stops anyone else from using it.
 *
 * The school comes from the host, not the link: a link signed for one school
 * fails on every other school's site.
 */
export async function GET(request: Request) {
  const secret = config.previewSecret;
  const owner = ownerFromHostname(request.headers.get("host") ?? "");
  const link =
    secret && owner
      ? verifyLink(secret, owner.key, new URL(request.url).searchParams, nowS())
      : null;
  if (!secret || !owner || !link) {
    return new Response("Tautan pratinjau ini tidak berlaku lagi. Buka lagi dari CMS.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const draft = await draftMode();
  const jar = await cookies();
  if (link.mode === "draft") {
    draft.enable();
    jar.set(PREVIEW_COOKIE, sessionValue(secret, owner.key, nowS()), cookieOptions());
  } else {
    draft.disable();
    jar.set(PREVIEW_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  }
  return redirect(link.path);
}

/**
 * The banner's exit button. Back to the page the editor was on, now as
 * visitors see it. Unsigned, because leaving preview can harm no one.
 */
export async function POST(request: Request) {
  (await draftMode()).disable();
  (await cookies()).set(PREVIEW_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return new Response(null, {
    status: 303,
    headers: { location: samePagePath(request.headers.get("referer")) },
  });
}

/** The path of the page the form was sent from, never another host. */
function samePagePath(referer: string | null): string {
  if (!referer) return "/";
  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}
