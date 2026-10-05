/**
 * The `/galeri` and `/unduhan` page rows each school starts with.
 *
 * Title-only, like `/fasilitas`: both listings are whatever has been published
 * in the Album and Berkas collections, so the row exists for the title and the
 * SEO fields. One file for the two because they are the same seed twice.
 *
 * The umbrella has neither. Photographs and files belong to a school, and the
 * apex answers 404 for both routes, the shape `/program` established.
 *
 * No albums or files are seeded, in development either: both are uploads, and
 * a seed cannot invent a photograph or a PDF. Upload a few in the local admin
 * panel to see the pages filled.
 */

import type { OwnerKey } from "./home-page";

export type ListingSeed = { title: string };

export const GALERI_PAGE_SEED: Partial<Record<OwnerKey, ListingSeed>> = {
  smp: { title: "Galeri SMP Islam Terpadu Madina" },
  smk: { title: "Galeri SMK Terpadu Madina" },
  sma: { title: "Galeri SMA Madina Citra Insani" },
};

export const UNDUHAN_PAGE_SEED: Partial<Record<OwnerKey, ListingSeed>> = {
  smp: { title: "Unduhan SMP Islam Terpadu Madina" },
  smk: { title: "Unduhan SMK Terpadu Madina" },
  sma: { title: "Unduhan SMA Madina Citra Insani" },
};
