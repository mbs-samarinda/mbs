/**
 * The `/artikel` page row each owner starts with.
 *
 * It carries no blocks. The listing itself — the type filter, the entries, the
 * archive, the admission card — is drawn by the page from the Berita,
 * Pengumuman and Opini collections, and none of it is something an editor
 * composes. What the row is for is the title and the SEO fields, which have to
 * live somewhere. The three per-type listings take fixed titles in code rather
 * than a row each nobody would fill in.
 *
 * The articles themselves are seeded in development only — see `articles.ts`.
 * This row is not: it carries no claim, only the title and the SEO fields, and
 * an editor needs it to exist before they can publish anything.
 */

import type { OwnerKey } from "./home-page";

export type ArtikelSeed = { title: string };

export const ARTIKEL_SEED: Record<OwnerKey, ArtikelSeed> = {
  mbs: { title: "Artikel Madina Boarding School" },
  smp: { title: "Artikel SMP Islam Terpadu Madina" },
  smk: { title: "Artikel SMK Terpadu Madina" },
  sma: { title: "Artikel SMA Madina Citra Insani" },
};
