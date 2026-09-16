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
 *
 * `seedEntries` skips an owner that already holds any record, so a database
 * seeded before `meta` and `facts` existed keeps its rows without them: the cards
 * render with no schedule line and the detail pages with no panel. Nothing
 * errors, there is simply nothing in the fields. Drop the local database to see
 * them.
 */

import type { OwnerKey } from "./home-page";

export type EntrySeed = {
  ownerKey: OwnerKey;
  title: string;
  slug: string;
  summary: string;
  /** The one-line schedule under a card's title. Short: the card gives it a line. */
  meta?: string;
  body: string;
  /**
   * The panel beside the body on the detail page. Labels are free text rather
   * than fixed fields — an activity has a Pembina and a facility has a Kapasitas,
   * and the same panel draws both.
   */
  facts?: { label: string; value: string }[];
};

const shared = (ownerKey: OwnerKey): EntrySeed[] => [
  {
    ownerKey,
    title: "Tahfiz Qur'an",
    slug: "tahfiz-quran",
    summary: "Setoran hafalan harian dengan pembina asrama, dari juz 30 ke atas.",
    meta: "Setiap hari · 05.30 WITA",
    body: "Program tahfiz berjalan setiap hari di luar jam pelajaran, dengan setoran pagi sebelum kelas dan muraja'ah setelah maghrib.\n\nSantri dikelompokkan menurut capaian hafalan, bukan menurut kelas, sehingga tiap kelompok berjalan pada kecepatan yang sama. Pembina mencatat capaian tiap pekan dan melaporkannya kepada orang tua/wali pada akhir semester.",
    facts: [
      { label: "Jadwal", value: "Setiap hari, 05.30 dan ba'da maghrib" },
      { label: "Tempat", value: "Masjid dan asrama" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Semua tingkat" },
    ],
  },
  {
    ownerKey,
    title: "Panahan",
    slug: "panahan",
    summary: "Latihan rutin dua kali sepekan di lapangan kampus.",
    meta: "Rabu & Sabtu · 16.00 WITA",
    body: "Panahan dilatih dua kali sepekan, Rabu sore dan Sabtu pagi, dengan peralatan yang disediakan sekolah.\n\nLatihan dibuka untuk semua tingkat. Santri yang menunjukkan capaian stabil diikutkan pada kejuaraan pelajar tingkat kota dan kabupaten.",
    facts: [
      { label: "Jadwal", value: "Rabu, 16.00–17.30 WITA dan Sabtu pagi" },
      { label: "Tempat", value: "Lapangan belakang asrama" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Alat", value: "Disediakan sekolah" },
    ],
  },
  {
    ownerKey,
    title: "Pramuka",
    slug: "pramuka",
    summary: "Kegiatan wajib kelas VII sampai IX, dengan perkemahan tiap semester.",
    meta: "Jumat · 15.30 WITA",
    body: "Kepramukaan berjalan sebagai kegiatan wajib mingguan dan mencakup keterampilan dasar lapangan, kepemimpinan regu, dan kerja sama.\n\nSetiap semester ditutup dengan perkemahan dua hari di lingkungan kampus.",
    facts: [
      { label: "Jadwal", value: "Jumat, 15.30–17.00 WITA" },
      { label: "Tempat", value: "Lapangan kampus" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Wajib, semua tingkat" },
    ],
  },
  {
    ownerKey,
    title: "Futsal",
    slug: "futsal",
    summary: "Latihan sore di lapangan serbaguna, terbuka untuk semua tingkat.",
    meta: "Selasa & Kamis · 16.00 WITA",
    body: "Latihan futsal berjalan tiga kali sepekan pada sore hari, dengan pembagian kelompok menurut tingkat.\n\nSekolah mengikutsertakan tim pada turnamen antar sekolah di Samarinda sepanjang tahun ajaran.",
    facts: [
      { label: "Jadwal", value: "Selasa, Kamis, dan Sabtu sore" },
      { label: "Tempat", value: "Lapangan serbaguna" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Semua tingkat" },
    ],
  },
];

export const EKSTRAKURIKULER_SEED: EntrySeed[] = [
  ...shared("smp"),
  {
    ownerKey: "smp",
    title: "Karya Ilmiah Remaja",
    slug: "karya-ilmiah-remaja",
    summary: "Pendampingan penelitian sederhana dan lomba karya tulis.",
    meta: "Kamis · 15.30 WITA",
    body: "Kelompok karya ilmiah mendampingi santri menyusun penelitian sederhana, dari perumusan masalah sampai penyajian hasil.\n\nKarya terpilih diikutkan pada lomba tingkat kota dan provinsi.",
    facts: [
      { label: "Jadwal", value: "Kamis, 15.30–17.00 WITA" },
      { label: "Tempat", value: "Ruang kelas dan laboratorium" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Kelas VIII–IX" },
    ],
  },
  ...shared("smk"),
  {
    ownerKey: "smk",
    title: "Robotik",
    slug: "robotik",
    summary: "Perakitan dan pemrograman robot lini, didampingi guru TKJ.",
    meta: "Jumat · 15.30 WITA",
    body: "Kegiatan robotik berjalan di laboratorium komputer setiap Jumat sore, mencakup perakitan, pemrograman mikrokontroler, dan uji lintasan.\n\nKegiatan ini terbuka untuk semua jurusan, bukan hanya TKJ.",
    facts: [
      { label: "Jadwal", value: "Jumat, 15.30–17.30 WITA" },
      { label: "Tempat", value: "Laboratorium komputer" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Alat", value: "Disediakan sekolah" },
    ],
  },
  {
    ownerKey: "smk",
    title: "Lembaga Kewirausahaan Santri",
    slug: "kewirausahaan-santri",
    summary: "Unit usaha kecil yang dijalankan santri bersama guru pendamping.",
    meta: "Setiap hari · di luar jam kelas",
    body: "Santri menjalankan unit usaha kecil di lingkungan kampus — kantin kejujuran, produksi makanan ringan, dan jasa servis komputer ringan.\n\nPembukuan disusun santri sendiri dan diperiksa guru pendamping tiap bulan.",
    facts: [
      { label: "Jadwal", value: "Setiap hari di luar jam pelajaran" },
      { label: "Tempat", value: "Unit usaha kampus" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Semua jurusan" },
    ],
  },
  ...shared("sma"),
  {
    ownerKey: "sma",
    title: "Jurnalistik",
    slug: "jurnalistik",
    summary: "Buletin sekolah, peliputan kegiatan, dan dasar-dasar fotografi.",
    meta: "Rabu · 15.30 WITA",
    body: "Kelompok jurnalistik menyusun buletin sekolah, meliput kegiatan kampus, dan mengelola arsip foto kegiatan.\n\nPelatihan mencakup penulisan berita, wawancara, dan dasar fotografi.",
    facts: [
      { label: "Jadwal", value: "Rabu, 15.30–17.00 WITA" },
      { label: "Tempat", value: "Ruang redaksi" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Semua tingkat" },
    ],
  },
  {
    ownerKey: "sma",
    title: "Debat Bahasa Inggris",
    slug: "debat-bahasa-inggris",
    summary: "Latihan debat parlementer dan persiapan lomba tingkat provinsi.",
    meta: "Senin & Kamis · 16.00 WITA",
    body: "Latihan debat berjalan dua kali sepekan dengan format parlementer Asia, mencakup penyusunan argumen, sanggahan, dan manajemen waktu bicara.\n\nTim inti disiapkan untuk lomba tingkat kota dan provinsi.",
    facts: [
      { label: "Jadwal", value: "Senin dan Kamis, 16.00–17.30 WITA" },
      { label: "Tempat", value: "Ruang kelas" },
      { label: "Pembina", value: "Isi dengan nama pembina" },
      { label: "Terbuka untuk", value: "Kelas X–XII" },
    ],
  },
];
