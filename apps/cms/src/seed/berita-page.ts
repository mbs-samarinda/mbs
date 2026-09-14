/**
 * The `/berita` page row each owner starts with.
 *
 * It carries no blocks. The listing itself — the type filter, the entries, the
 * archive, the admission card — is drawn by the page from the Berita and
 * Pengumuman collections, and none of it is something an editor composes. What
 * the row is for is the title and the SEO fields, which have to live somewhere.
 *
 * The articles themselves are seeded in development only — see `articles.ts`.
 * This row is not: it carries no claim, only the title and the SEO fields, and
 * an editor needs it to exist before they can publish anything.
 */

import type { OwnerKey } from "./home-page";

export type BeritaSeed = { title: string };

export const BERITA_SEED: Record<OwnerKey, BeritaSeed> = {
  mbs: { title: "Berita & Pengumuman Madina Boarding School" },
  smp: { title: "Berita & Pengumuman SMP Islam Terpadu Madina" },
  smk: { title: "Berita & Pengumuman SMK Terpadu Madina" },
  sma: { title: "Berita & Pengumuman SMA Madina Citra Insani" },
};
