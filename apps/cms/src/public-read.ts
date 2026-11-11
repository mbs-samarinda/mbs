import type { Core } from "@strapi/strapi";

/**
 * What the profile sites read. Every one of these is already published content —
 * it is on a public website the moment an editor publishes it — so the Public
 * role reads them and no token exists to rotate or to leave out of a fresh
 * clone. Reading is all that is granted: nothing here creates, updates, or
 * deletes.
 */
export const PUBLIC_READ = [
  "api::site.site",
  "api::page.page",
  "api::berita.berita",
  "api::pengumuman.pengumuman",
  "api::opini.opini",
  "api::ekstrakurikuler.ekstrakurikuler",
  "api::fasilitas.fasilitas",
  "api::pencapaian.pencapaian",
  "api::album.album",
  "api::berkas.berkas",
  // Read through the articles: the profile filters and populates on it to list
  // a school's accepted collaborations and badge them.
  "api::kolaborasi.kolaborasi",
] as const;

/**
 * Makes the Public role's content grants exactly `PUBLIC_READ`, on every boot.
 *
 * Only `api::` actions are touched: the role also holds the users-permissions
 * plugin's own defaults, which are not ours to manage. A type taken off the list
 * loses its public read on the next boot, which an add-only seed never did.
 */
export async function syncPublicRead(strapi: Core.Strapi) {
  const role: { id: number } | null = await strapi.db
    .query("plugin::users-permissions.role")
    .findOne({ where: { type: "public" }, select: ["id"] });

  if (!role) {
    strapi.log.warn("No public role yet; skipping public read permissions this boot.");
    return;
  }

  const permissions = strapi.db.query("plugin::users-permissions.permission");
  const wanted = new Set(PUBLIC_READ.flatMap((uid) => [`${uid}.find`, `${uid}.findOne`]));
  const held: { id: number; action: string }[] = await permissions.findMany({
    where: { role: role.id, action: { $startsWith: "api::" } },
    select: ["id", "action"],
  });

  const extra = held.filter((row) => !wanted.has(row.action));
  if (extra.length > 0) {
    await permissions.deleteMany({ where: { id: { $in: extra.map((row) => row.id) } } });
  }
  for (const action of wanted) {
    if (held.some((row) => row.action === action)) continue;
    await permissions.create({ data: { action, role: role.id } });
  }
}
