/**
 * The activities each school starts with.
 *
 * **Development only.** These exist so a developer's site is not blank — the home
 * page draws an extracurriculars section from them, and a section with no
 * records renders nothing. On a real server they would be a claim that a school
 * runs a class it may not, so `index.ts` skips every content seed when
 * `NODE_ENV` is production. The seed only ever runs for an owner that has none.
 *
 * The umbrella has no extracurriculars — it runs no classes of its own — so it
 * has no entry here.
 */

import type { OwnerKey } from "./home-page";

export type EntrySeed = {
  ownerKey: OwnerKey;
  title: string;
  slug: string;
  summary: string;
  body: string;
};

const shared = (ownerKey: OwnerKey): EntrySeed[] => [
  {
    ownerKey,
    title: "Tahfiz Qur'an",
    slug: "tahfiz-quran",
    summary: "Setoran hafalan harian dengan pembina asrama, dari juz 30 ke atas.",
    body: "Program tahfiz berjalan setiap hari di luar jam pelajaran, dengan setoran pagi sebelum kelas dan muraja'ah setelah maghrib.\n\nSantri dikelompokkan menurut capaian hafalan, bukan menurut kelas, sehingga tiap kelompok berjalan pada kecepatan yang sama. Pembina mencatat capaian tiap pekan dan melaporkannya kepada orang tua/wali pada akhir semester.",
  },
  {
    ownerKey,
    title: "Panahan",
    slug: "panahan",
    summary: "Latihan rutin dua kali sepekan di lapangan kampus.",
    body: "Panahan dilatih dua kali sepekan, Rabu sore dan Sabtu pagi, dengan peralatan yang disediakan sekolah.\n\nLatihan dibuka untuk semua tingkat. Santri yang menunjukkan capaian stabil diikutkan pada kejuaraan pelajar tingkat kota dan kabupaten.",
  },
  {
    ownerKey,
    title: "Pramuka",
    slug: "pramuka",
    summary: "Kegiatan wajib kelas VII sampai IX, dengan perkemahan tiap semester.",
    body: "Kepramukaan berjalan sebagai kegiatan wajib mingguan dan mencakup keterampilan dasar lapangan, kepemimpinan regu, dan kerja sama.\n\nSetiap semester ditutup dengan perkemahan dua hari di lingkungan kampus.",
  },
  {
    ownerKey,
    title: "Futsal",
    slug: "futsal",
    summary: "Latihan sore di lapangan serbaguna, terbuka untuk semua tingkat.",
    body: "Latihan futsal berjalan tiga kali sepekan pada sore hari, dengan pembagian kelompok menurut tingkat.\n\nSekolah mengikutsertakan tim pada turnamen antar sekolah di Samarinda sepanjang tahun ajaran.",
  },
];

export const EKSTRAKURIKULER_SEED: EntrySeed[] = [
  ...shared("smp"),
  {
    ownerKey: "smp",
    title: "Karya Ilmiah Remaja",
    slug: "karya-ilmiah-remaja",
    summary: "Pendampingan penelitian sederhana dan lomba karya tulis.",
    body: "Kelompok karya ilmiah mendampingi santri menyusun penelitian sederhana, dari perumusan masalah sampai penyajian hasil.\n\nKarya terpilih diikutkan pada lomba tingkat kota dan provinsi.",
  },
  ...shared("smk"),
  {
    ownerKey: "smk",
    title: "Robotik",
    slug: "robotik",
    summary: "Perakitan dan pemrograman robot lini, didampingi guru TKJ.",
    body: "Kegiatan robotik berjalan di laboratorium komputer setiap Jumat sore, mencakup perakitan, pemrograman mikrokontroler, dan uji lintasan.\n\nKegiatan ini terbuka untuk semua jurusan, bukan hanya TKJ.",
  },
  {
    ownerKey: "smk",
    title: "Lembaga Kewirausahaan Santri",
    slug: "kewirausahaan-santri",
    summary: "Unit usaha kecil yang dijalankan santri bersama guru pendamping.",
    body: "Santri menjalankan unit usaha kecil di lingkungan kampus — kantin kejujuran, produksi makanan ringan, dan jasa servis komputer ringan.\n\nPembukuan disusun santri sendiri dan diperiksa guru pendamping tiap bulan.",
  },
  ...shared("sma"),
  {
    ownerKey: "sma",
    title: "Jurnalistik",
    slug: "jurnalistik",
    summary: "Buletin sekolah, peliputan kegiatan, dan dasar-dasar fotografi.",
    body: "Kelompok jurnalistik menyusun buletin sekolah, meliput kegiatan kampus, dan mengelola arsip foto kegiatan.\n\nPelatihan mencakup penulisan berita, wawancara, dan dasar fotografi.",
  },
  {
    ownerKey: "sma",
    title: "Debat Bahasa Inggris",
    slug: "debat-bahasa-inggris",
    summary: "Latihan debat parlementer dan persiapan lomba tingkat provinsi.",
    body: "Latihan debat berjalan dua kali sepekan dengan format parlementer Asia, mencakup penyusunan argumen, sanggahan, dan manajemen waktu bicara.\n\nTim inti disiapkan untuk lomba tingkat kota dan provinsi.",
  },
];
