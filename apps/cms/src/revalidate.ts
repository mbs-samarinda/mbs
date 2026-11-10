import type { Core } from "@strapi/strapi";

import { PUBLIC_READ } from "./public-read";

/**
 * What the profile sites read. A change to any of these can change a public
 * page, so the profile is told to drop its content cache.
 */
const PUBLIC_CONTENT = new Set<string>(PUBLIC_READ);

/**
 * What counts as a change the public can see.
 *
 * Everything except `Site` carries draft-and-publish, so an `update` there is an
 * editor saving a draft — invisible to visitors, and no reason to drop four
 * sites' caches. `Site` has `draftAndPublish: false`, so its `update` *is* the
 * live change, and gating it on `publish` would mean a renamed navigation item
 * never appearing. Kolaborasi is the same: a school accepting or leaving is the
 * change visitors see.
 */
const LIVE_ON_UPDATE = new Set<string>(["api::site.site", "api::kolaborasi.kolaborasi"]);
const PUBLISHED_CHANGE = new Set(["publish", "unpublish", "delete"]);
const DIRECT_CHANGE = new Set(["create", "update", "delete"]);

export const changesPublicPages = (uid: string, action: string) =>
  PUBLIC_CONTENT.has(uid) &&
  (LIVE_ON_UPDATE.has(uid) ? DIRECT_CHANGE.has(action) : PUBLISHED_CHANGE.has(action));

/**
 * Tells the profile application that published content changed.
 *
 * Fire-and-forget on purpose: an editor pressing Publish must not see a save
 * fail because a front end was restarting, and the pages are already correct
 * within the cache window without this. It only makes them prompt.
 *
 * Unset environment means this deployment has no profile to notify — a CMS
 * running alone, or a developer who has not filled in `.env`. That is quiet,
 * not a warning, because it is the normal state of a fresh clone.
 */
export async function notifyProfile(strapi: Core.Strapi) {
  const url = process.env.PROFILE_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
    if (!response.ok) {
      strapi.log.warn(`Profile revalidation returned ${response.status}.`);
    }
  } catch (error) {
    strapi.log.warn(`Profile revalidation failed: ${String(error)}`);
  }
}

// Any number works, as long as every CMS instance uses the same one. It only
// has to differ from the API's, which shares the Postgres server.
