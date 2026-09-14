/**
 * The `/berita` page row each owner starts with.
 *
 * It carries no blocks. The listing itself — the type filter, the entries, the
 * archive, the admission card — is drawn by the page from the Berita and
 * Pengumuman collections, and none of it is something an editor composes. What
 * the row is for is the title and the SEO fields, which have to live somewhere.
 *
 * No sample articles are seeded. The homepage seed's own rule applies: inventing
 * a plausible school event is not a placeholder, it is a lie with a date on it.
 * An owner with nothing published gets the empty state, which is a real state
 * the page has to handle anyway.
 */

import type { OwnerKey } from "./home-page";

export type BeritaSeed = { title: string };

export const BERITA_SEED: Record<OwnerKey, BeritaSeed> = {
  mbs: { title: "Berita & Pengumuman Madina Boarding School" },
  smp: { title: "Berita & Pengumuman SMP Islam Terpadu Madina" },
  smk: { title: "Berita & Pengumuman SMK Terpadu Madina" },
  sma: { title: "Berita & Pengumuman SMA Madina Citra Insani" },
};
