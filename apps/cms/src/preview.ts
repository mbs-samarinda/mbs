import { createHmac } from "node:crypto";

import type { UID } from "@strapi/strapi";

import { profileOrigin } from "./profile-urls";
import { OWNER_KEYS } from "./seed/home-page";

/**
 * Strapi's Preview button: which page of the profile shows an entry, and a
 * signed link that turns on Draft Mode there.
 *
 * The link is signed, not keyed with a fixed secret, because Strapi puts it in
 * the editor's browser and offers "Copy preview link". A fixed secret pasted
 * into a group chat would read every school's drafts forever. A signed link
 * names one school and one page and stops working after an hour.
 */

// Unset means production's compose forgot it, which deploy.sh refuses, or a
// developer's machine, where the profile runs on localhost.
const APEX = process.env.PROFILE_APEX || "localhost";

const LINK_LIFETIME_S = 60 * 60;

/** The page each type is seen on. Types with no page of their own get no Preview button. */
const PAGES = {
  "api::site.site": () => "/",
  "api::page.page": (slug) => (slug === "home" ? "/" : `/${slug}`),
  "api::berita.berita": (slug) => `/artikel/berita/${slug}`,
  "api::pengumuman.pengumuman": (slug) => `/artikel/pengumuman/${slug}`,
  "api::opini.opini": (slug) => `/artikel/opini/${slug}`,
  "api::ekstrakurikuler.ekstrakurikuler": (slug) => `/ekstrakurikuler/${slug}`,
  "api::fasilitas.fasilitas": (slug) => `/fasilitas/${slug}`,
  "api::album.album": (slug) => `/galeri/${slug}`,
  "api::berkas.berkas": () => "/unduhan",
  // Achievements show on the school's home page.
  "api::pencapaian.pencapaian": () => "/",
} satisfies Partial<Record<UID.ContentType, (slug: string) => string>>;

const hasPage = (uid: string): uid is keyof typeof PAGES => uid in PAGES;

/** The two fields a link needs, from whichever type the entry is. */
const text = (entry: unknown, field: string) => {
  const value: unknown =
    typeof entry === "object" && entry !== null ? Reflect.get(entry, field) : undefined;
  return typeof value === "string" ? value : "";
};

export const previewConfig = () => ({
  enabled: true,
  config: {
    // Strapi adds these to its own `frame-src`, so its preview frame may load them.
    allowedOrigins: OWNER_KEYS.map((key) => profileOrigin(key, APEX)),
    handler: previewUrl,
  },
});

async function previewUrl(
  uid: string,
  { documentId, status }: { documentId: string; status?: string },
): Promise<string | null> {
  const secret = process.env.PREVIEW_SECRET;
  if (!secret || !hasPage(uid)) return null;

  // The draft, because it always exists: an entry never published has no
  // published version, and the page it previews is the same either way.
  const entry: unknown = await strapi.documents(uid).findOne({ documentId, status: "draft" });
  const ownerKey = text(entry, "ownerKey");
  if (!ownerKey) return null;

  const path = PAGES[uid](text(entry, "slug"));
  const exp = Math.floor(Date.now() / 1000) + LINK_LIFETIME_S;
  const mode = status === "published" ? "published" : "draft";
  const query = new URLSearchParams({
    path,
    mode,
    exp: String(exp),
    sig: sign(secret, [ownerKey, path, mode, String(exp)]),
  });
  return `${profileOrigin(ownerKey, APEX)}/api/draft?${query.toString()}`;
}

/**
 * The same signature `apps/profile/src/preview.ts` checks. The owner is signed
 * but not sent: the profile takes it from the host the link opened on, so a
 * link only works on its own school's site.
 */
function sign(secret: string, fields: string[]): string {
  return createHmac("sha256", secret).update(fields.join("\n")).digest("hex");
}
