import type { Core } from "@strapi/strapi";

/**
 * What the profile sites read, and all the profile's token may do: find and
 * findOne on these types.
 */
export const PROFILE_READ = [
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

export const PROFILE_TOKEN_NAME = "profile-read";

/** The profile app requires the same length, so a shorter key fails here first. */
const MIN_KEY_LENGTH = 32;

const actions = () => PROFILE_READ.flatMap((uid) => [`${uid}.find`, `${uid}.findOne`]);

/**
 * Makes the Public role's content grants exactly `PROFILE_READ`, on every boot.
 *
 * Kept for one release only. Deploys restart the CMS before the profile, so the
 * profile still running from the last release reads without a token until it
 * is swapped. The next release takes these grants away, because Strapi answers
 * `?status=draft` to anyone allowed to `find`.
 *
 * Only `api::` actions are touched: the role also holds the users-permissions
 * plugin's own defaults, which are not ours to manage.
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
  const wanted = new Set(actions());
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

type TokenService = {
  hash(accessKey: string): string;
  create(attributes: {
    name: string;
    description: string;
    type: "custom";
    lifespan: null;
    permissions: string[];
  }): Promise<{ id: number }>;
  revoke(id: number): Promise<unknown>;
};

type EncryptionService = { encrypt(value: string): string | null };

/**
 * Rebuilds the `profile-read` token on every boot: it holds exactly
 * `PROFILE_READ`, never expires, and opens with `CMS_READ_TOKEN`.
 *
 * Strapi only makes random keys, so the key is written over afterwards. That
 * keeps it one shared secret set in both apps' environment, like
 * `REVALIDATE_SECRET`, instead of a key someone copies out of the admin panel
 * once and loses.
 *
 * Created again rather than updated. A row with this name or this key may have
 * been edited in the panel: renamed, given an expiry, widened, or turned into
 * an admin token. Starting over undoes all of those without a check for each.
 * "Regenerate" in the panel works until the next boot.
 *
 * Unset means no profile reads this CMS with a token (a CMS running alone, or a
 * fresh clone without `.env`). Any old `profile-read` token is still removed,
 * so unsetting the key is how to switch off a leaked one.
 */
export async function syncProfileToken(strapi: Core.Strapi) {
  const key = process.env.CMS_READ_TOKEN;
  if (key && key.length < MIN_KEY_LENGTH) {
    throw new Error(`CMS_READ_TOKEN must be at least ${MIN_KEY_LENGTH} characters.`);
  }

  /* oxlint-disable typescript/no-unsafe-type-assertion -- admin services sit outside the generated UID union */
  const tokens = strapi.service("admin::api-token-content-api") as unknown as TokenService;
  const encryption = strapi.service("admin::encryption") as unknown as EncryptionService;
  /* oxlint-enable typescript/no-unsafe-type-assertion */

  const rows = strapi.db.query("admin::api-token");
  const previous: { id: number }[] = await rows.findMany({
    where: key
      ? { $or: [{ name: PROFILE_TOKEN_NAME }, { accessKey: tokens.hash(key) }] }
      : { name: PROFILE_TOKEN_NAME },
    select: ["id"],
  });

  // The new token first, so a failed create leaves the old one working.
  const created = key
    ? await tokens.create({
        name: PROFILE_TOKEN_NAME,
        description:
          "How the profile sites read content. Rebuilt from CMS_READ_TOKEN on every boot.",
        type: "custom",
        lifespan: null,
        permissions: actions(),
      })
    : null;

  // `revoke` leaves a content token's permission rows behind; every boot would add more.
  const ids = previous.map((row) => row.id);
  await strapi.db
    .query("admin::api-token-permission")
    .deleteMany({ where: { token: { id: { $in: ids } } } });
  await Promise.all(ids.map((id) => tokens.revoke(id)));

  if (!key || !created) {
    strapi.log.warn("CMS_READ_TOKEN is unset; no read token for the profile.");
    return;
  }
  await rows.update({
    where: { id: created.id },
    // `encryptedKey` is what the panel shows when someone views the token.
    data: { accessKey: tokens.hash(key), encryptedKey: encryption.encrypt(key) },
  });
}
