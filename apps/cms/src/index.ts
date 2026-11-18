import type { Core } from "@strapi/strapi";

import {
  backfillApexHomeOnly,
  backfillApexMainMenu,
  backfillArtikel,
  backfillContactNumbers,
  backfillOnce,
  backfillSchoolLinks,
  deleteApexPages,
} from "./backfills";
import { trackCollaborations } from "./collaboration";
import { assertOwnerScope, registerOwnerScope, syncEditorRole } from "./owner-scope";
import { syncPublicRead } from "./public-read";
import { changesPublicPages, notifyProfile } from "./revalidate";
import { seedRoutePages, seedSampleRecords, seedSites } from "./seed/run";

// Any number works, as long as every CMS instance uses the same one. It only
// has to differ from the API's, which shares the Postgres server.
const BOOT_LOCK = 4820194;

/**
 * Runs bootstrap while holding a Postgres advisory lock, so two instances that
 * boot together take turns instead of both seeing a marker unset or a row
 * missing and both writing it. The seeds and backfills below assume they run
 * alone; this is what makes that true.
 *
 * A session lock belongs to one connection, so it is taken and released on a
 * connection set aside for it. If the release fails, that connection is closed
 * before it goes back to the pool: closing the session frees the lock, where a
 * pooled connection still holding it would stall the next boot. The wait is bounded
 * by `lock_timeout` (`BOOT_LOCK_TIMEOUT`, a Postgres time such as 30s, default 5min),
 * so a hung instance stops the next boot with a reason instead of hanging it.
 */
async function withBootLock(strapi: Core.Strapi, run: () => Promise<void>) {
  const wait = process.env.BOOT_LOCK_TIMEOUT || "5min";
  const knex = strapi.db.connection;
  const connection: unknown = await knex.client.acquireConnection();
  try {
    await knex.raw("select set_config('lock_timeout', ?, false)", [wait]).connection(connection);
    await knex
      .raw("select pg_advisory_lock(?)", [BOOT_LOCK])
      .connection(connection)
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "55P03"
        ) {
          throw new Error(
            `Another CMS instance has held the boot lock (${BOOT_LOCK}) for over ${wait}. Stop it, or find the session holding the lock in pg_locks.`,
          );
        }
        throw error;
      });
    await run();
  } finally {
    // Also undoes `lock_timeout`, so the connection goes back to the pool as it came.
    await knex
      .raw("select pg_advisory_unlock_all(); reset lock_timeout")
      .connection(connection)
      .catch(async (error: unknown) => {
        strapi.log.warn(`Boot lock release failed, closing its connection: ${String(error)}`);
        // A failure here is already logged; it must not hide what `run` threw.
        await knex.client.destroyRawConnection(connection).catch(() => undefined);
      });
    await knex.client.releaseConnection(connection);
  }
}

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Registered here rather than configured in the admin panel's webhook
    // screen, for the same reason the public read permissions are: a fresh
    // clone has to work without somebody remembering a manual step, and a
    // forgotten webhook shows up as content that is silently hours stale.
    strapi.documents.use(async (context, next) => {
      // Before the write, not after: a condition cannot see a row that does not
      // exist yet, so create is guarded here or nowhere.
      await assertOwnerScope(strapi, context);

      const collaborations = await trackCollaborations(strapi, context);
      const result = await next();
      await collaborations(result);

      if (changesPublicPages(context.uid, context.action)) {
        void notifyProfile(strapi);
      }

      return result;
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await withBootLock(strapi, async () => {
      // The condition first: seeding a permission whose condition the provider
      // does not know yet drops the condition and grants the permission outright.
      await registerOwnerScope(strapi);
      await syncEditorRole(strapi);
      await syncPublicRead(strapi);
      await seedSites(strapi);
      // Galeri first: Unduhan anchors on the footer's `/berita` link, which
      // Artikel then replaces. Artikel has to rename the `berita` page before
      // `seedRoutePages` sees no `artikel` row and makes one.
      await backfillOnce(strapi, "galeri-unduhan-links", () => backfillSchoolLinks(strapi));
      await backfillOnce(strapi, "artikel", () => backfillArtikel(strapi));

      // Records before pages: the homepage and profil sections point at the
      // records by document id.
      await seedSampleRecords(strapi);
      await seedRoutePages(strapi);

      // After the seeds, and once per database: the rows above are only created
      // when missing, so a section added to a seed later needs this to reach an
      // environment that has already booted.
      await backfillOnce(strapi, "apex-main-menu", () => backfillApexMainMenu(strapi));
      await backfillOnce(strapi, "apex-home-only", () => backfillApexHomeOnly(strapi));
      await backfillOnce(strapi, "apex-pages-deleted", () => deleteApexPages(strapi));
      await backfillOnce(strapi, "contact-numbers", () => backfillContactNumbers(strapi));
    });
  },
};
