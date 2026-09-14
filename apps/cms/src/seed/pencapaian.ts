/**
 * The achievements a development database starts with.
 *
 * **Development only**, like the articles and the facilities: an achievement
 * names a winner and a year, which is a claim. `index.ts` skips it when
 * `NODE_ENV` is production.
 *
 * `recipient` names a team rather than a person wherever the activity has one:
 * a seeded student name is a claim about a child on a public website, and the
 * only names here are the ones an editor will replace anyway.
 *
 * `beritaSlug` links an achievement to the article that tells its story, which
 * is the relation the article page reads backwards. The slug is resolved to a
 * document at seed time, and an achievement whose article is missing is simply
 * seeded without the link.
 *
 * The umbrella has none: pencapaian belongs to the school that earned it.
 */

import type { OwnerKey } from "./home-page";

export type AchievementSeed = {
  ownerKey: OwnerKey;
  title: string;
  slug: string;
  level: "sekolah" | "kabupaten" | "provinsi" | "nasional" | "internasional";
  /** Years before the boot that creates it, so the list never looks stale. */
  yearsAgo: number;
  recipient: string;
  description: string;
  beritaSlug?: string;
};

export const PENCAPAIAN_SEED: AchievementSeed[] = [
  {
    ownerKey: "smp",
    title: "Juara 2 Lomba Karya Ilmiah Remaja",
    slug: "juara-2-karya-ilmiah-remaja",
    level: "kabupaten",
    yearsAgo: 0,
    recipient: "Kelompok Karya Ilmiah SMP",
    description: "Penelitian sederhana yang disusun sepanjang satu semester.",
    beritaSlug: "karya-ilmiah-babak-akhir-lomba-kota",
  },
  {
    ownerKey: "smp",
    title: "Juara 1 Musabaqah Hifzil Qur'an tingkat kota",
    slug: "juara-1-mhq-tingkat-kota",
    level: "kabupaten",
    yearsAgo: 1,
    recipient: "Kelompok Tahfiz SMP",
    description: "Kategori lima juz, diikuti pelajar se-kota Samarinda.",
  },
  {
    ownerKey: "smk",
    title: "Juara 1 Panahan Pelajar",
    slug: "juara-1-panahan-pelajar",
    level: "kabupaten",
    yearsAgo: 0,
    recipient: "Tim Panahan SMK",
    description: "Tiga kategori diikuti, satu emas pada babak final.",
    beritaSlug: "tim-panahan-juara-kabupaten",
  },
  {
    ownerKey: "smk",
    title: "Finalis Lomba Kompetensi Siswa bidang jaringan",
    slug: "finalis-lks-bidang-jaringan",
    level: "provinsi",
    yearsAgo: 1,
    recipient: "Jurusan Teknik Komputer dan Jaringan",
    description: "Babak final tingkat provinsi untuk bidang jaringan komputer.",
  },
  {
    ownerKey: "sma",
    title: "Juara 2 Debat Bahasa Inggris tingkat provinsi",
    slug: "juara-2-debat-bahasa-inggris",
    level: "provinsi",
    yearsAgo: 0,
    recipient: "Tim Debat SMA",
    description: "Format parlementer Asia, empat babak penyisihan.",
    beritaSlug: "tim-debat-seleksi-provinsi",
  },
  {
    ownerKey: "sma",
    title: "Juara 3 Olimpiade Sains tingkat kota",
    slug: "juara-3-olimpiade-sains-kota",
    level: "kabupaten",
    yearsAgo: 2,
    recipient: "Kelompok Olimpiade SMA",
    description: "Bidang biologi, seleksi tertulis dan praktik laboratorium.",
  },
];
