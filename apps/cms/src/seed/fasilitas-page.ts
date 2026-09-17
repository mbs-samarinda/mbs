/**
 * The `/fasilitas` page row each school starts with.
 *
 * It carries no blocks, for the same reason `/ekstrakurikuler` and `/berita` do
 * not: the listing is drawn from the Fasilitas collection, and which buildings
 * appear is a consequence of what has been published rather than something an
 * editor composes. What the row is for is the title and the SEO fields.
 *
 * The umbrella has no entry. Every building belongs to one of the three schools,
 * its navigation carries no such item, and the canvas draws it no such page — so
 * the route answers 404 at the apex, the shape `/program` established.
 *
 * The row itself is not a content seed: it states no fact about a school, so it
 * reaches production alongside the other page rows. The facilities it lists are
 * seeded in development only — see `fasilitas.ts`.
 */

import type { OwnerKey } from "./home-page";

export type FasilitasSeed = { title: string };

export const FASILITAS_PAGE_SEED: Partial<Record<OwnerKey, FasilitasSeed>> = {
  smp: { title: "Fasilitas SMP Islam Terpadu Madina" },
  smk: { title: "Fasilitas SMK Terpadu Madina" },
  sma: { title: "Fasilitas SMA Madina Citra Insani" },
};
