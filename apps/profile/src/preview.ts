import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The checks behind editor preview (Draft Mode).
 *
 * Next's own Draft Mode cookie is one value for the whole build, so on its own
 * it would show any school's drafts to anyone holding it. Two things narrow it:
 *
 * - The CMS signs each Preview link for one school and one page, for an hour
 *   (`apps/cms/src/preview.ts` signs the same fields the same way).
 * - Opening one sets a second cookie signed for that school. `proxy.ts` drops
 *   the Draft Mode cookie from any request whose school cookie is missing,
 *   expired, or signed for another school.
 */

/** Next's name for the Draft Mode cookie. */
export const DRAFT_COOKIE = "__prerender_bypass";

/** Ours: which school this browser may preview, and until when. */
export const PREVIEW_COOKIE = "mbs-preview";

/** How long a preview lasts after the editor last opened a link from the CMS. */
export const SESSION_S = 12 * 60 * 60;

export type PreviewLink = { readonly path: string; readonly mode: "draft" | "published" };

const sign = (secret: string, fields: string[]) =>
  createHmac("sha256", secret).update(fields.join("\n")).digest("hex");

/** Hex strings of equal length compare in constant time; anything else is a mismatch. */
const sameSignature = (given: string, expected: string) =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

// Only a path on this host: `//evil.example` and `/\evil.example` are read as
// other hosts by browsers.
const isLocalPath = (path: string) => /^\/(?![/\\])/.test(path);

/** The link's page and mode, or null when it is forged, edited, expired, or for another school. */
export function verifyLink(
  secret: string,
  ownerKey: string,
  params: URLSearchParams,
  nowS: number,
): PreviewLink | null {
  const path = params.get("path") ?? "";
  const mode = params.get("mode");
  const exp = params.get("exp") ?? "";
  const sig = params.get("sig") ?? "";
  if (!isLocalPath(path) || (mode !== "draft" && mode !== "published")) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < nowS) return null;
  if (!sameSignature(sig, sign(secret, [ownerKey, path, mode, exp]))) return null;
  return { path, mode };
}

export function sessionValue(secret: string, ownerKey: string, nowS: number): string {
  const exp = String(nowS + SESSION_S);
  return `${exp}.${sign(secret, [ownerKey, "session", exp])}`;
}

export function isValidSession(
  secret: string,
  ownerKey: string,
  value: string | undefined,
  nowS: number,
): boolean {
  const [exp = "", sig = ""] = (value ?? "").split(".");
  if (!/^\d+$/.test(exp) || Number(exp) < nowS) return false;
  return sameSignature(sig, sign(secret, [ownerKey, "session", exp]));
}

/** Seconds since the epoch, the unit both signatures use. */
export const nowS = () => Math.floor(Date.now() / 1000);

/**
 * The same attributes Next gives its Draft Mode cookie, so the two live and
 * die together. `none` lets Strapi's preview frame send them.
 */
export const cookieOptions = () => {
  const dev = process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    path: "/",
    sameSite: dev ? ("lax" as const) : ("none" as const),
    secure: !dev,
    maxAge: SESSION_S,
  };
};
