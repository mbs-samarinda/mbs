/**
 * The `/ekstrakurikuler` page row each school starts with.
 *
 * It carries no blocks, for the same reason `/berita` does not: the listing is
 * drawn from the Ekstrakurikuler collection, and which activities appear is a
 * consequence of what has been published, not something an editor composes. What
 * the row is for is the title and the SEO fields.
 *
 * The umbrella has no entry. It runs no classes, its navigation carries no such
 * item, and the canvas draws it no such page — so the route answers 404 at the
 * apex, the shape `/program` established.
 *
 * The row itself is not a content seed: it states no fact about a school, so it
 * reaches production alongside the other page rows. The activities it lists are
 * seeded in development only — see `ekstrakurikuler.ts`.
 */

import type { OwnerKey } from "./home-page";

export type EkstrakurikulerSeed = { title: string };

export const EKSTRAKURIKULER_PAGE_SEED: Partial<Record<OwnerKey, EkstrakurikulerSeed>> = {
  smp: { title: "Ekstrakurikuler SMP Islam Terpadu Madina" },
  smk: { title: "Ekstrakurikuler SMK Terpadu Madina" },
  sma: { title: "Ekstrakurikuler SMA Madina Citra Insani" },
};
