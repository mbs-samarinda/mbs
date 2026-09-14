/**
 * The news and notices each owner starts with.
 *
 * `/berita` is one listing over two collections, so both are seeded together and
 * their addresses are checked against each other by `uniqueSlugPerOwner`.
 *
 * Dates are relative to the boot that creates them, not fixed strings: a seed
 * with hard-coded dates is a site that looks abandoned the moment it is deployed
 * a month later. `publishedAt` is passed explicitly for the same reason the
 * listing sorts on it — the order on the page is the order written here.
 *
 * **Development only.** An article states that something happened on a date, so
 * a seeded one on a school's live website is a lie with a date on it however
 * plainly it was meant as filler. `index.ts` skips every content seed when
 * `NODE_ENV` is production; a real server starts empty and an editor fills it.
 */

import type { OwnerKey } from "./home-page";

export type ArticleSeed = {
  ownerKey: OwnerKey;
  title: string;
  slug: string;
  summary: string;
  body: string;
  attribution: string;
  /** Days before the boot that creates it. Newest first on the page. */
  daysAgo: number;
  /** Pengumuman only. Days after that boot, when it drops out of the listing. */
  expiresInDays?: number;
};

const HUMAS = (name: string) => `Humas ${name}`;

export const BERITA_ENTRY_SEED: ArticleSeed[] = [
  {
    ownerKey: "mbs",
    title: "Wisuda tahfiz angkatan kesembilan",
    slug: "wisuda-tahfiz-angkatan-kesembilan",
    summary: "Santri dari tiga sekolah menuntaskan setoran hafalan tahun ini.",
    body: "Wisuda tahfiz angkatan kesembilan berlangsung di masjid kampus, diikuti santri dari ketiga sekolah di bawah Madina Boarding School.\n\nAcara dibuka dengan sima'an bersama, dilanjutkan penyerahan sertifikat capaian hafalan kepada tiap santri. Orang tua/wali hadir mendampingi.\n\nPembina tahfiz menyampaikan bahwa capaian tahun ini disusun dari setoran harian sepanjang tahun ajaran, bukan dari persiapan menjelang acara.",
    attribution: "Sekretariat Yayasan",
    daysAgo: 9,
  },
  {
    ownerKey: "mbs",
    title: "Pembangunan asrama putri tahap dua dimulai",
    slug: "pembangunan-asrama-putri-tahap-dua",
    summary: "Kapasitas bertambah untuk penerimaan tahun depan.",
    body: "Pembangunan asrama putri tahap dua dimulai pekan ini di sisi timur kampus.\n\nTahap ini menambah kamar dan ruang belajar bersama, dan dikerjakan di luar jam kegiatan santri agar tidak mengganggu pelajaran.\n\nPenambahan kapasitas disiapkan untuk penerimaan tahun ajaran berikutnya.",
    attribution: "Sekretariat Yayasan",
    daysAgo: 21,
  },
  {
    ownerKey: "smp",
    title: "Karya ilmiah santri masuk babak akhir lomba kota",
    slug: "karya-ilmiah-babak-akhir-lomba-kota",
    summary: "Dua kelompok maju ke presentasi akhir tingkat kota.",
    body: "Dua kelompok karya ilmiah remaja lolos ke babak presentasi akhir lomba tingkat kota.\n\nKeduanya menyusun penelitian sederhana sepanjang satu semester, dengan pendampingan guru pembimbing pada tiap tahap.\n\nPresentasi akhir dijadwalkan pekan depan di aula dinas pendidikan kota.",
    attribution: HUMAS("SMP Islam Terpadu Madina"),
    daysAgo: 6,
  },
  {
    ownerKey: "smp",
    title: "Perkemahan akhir semester berjalan dua hari",
    slug: "perkemahan-akhir-semester",
    summary: "Kegiatan kepramukaan ditutup dengan perkemahan di lingkungan kampus.",
    body: "Perkemahan akhir semester berjalan dua hari di lingkungan kampus, diikuti seluruh santri kelas VII dan VIII.\n\nKegiatan mencakup keterampilan dasar lapangan, kerja regu, dan malam keakraban.\n\nSeluruh kegiatan berlangsung di dalam kampus dan didampingi pembina asrama.",
    attribution: HUMAS("SMP Islam Terpadu Madina"),
    daysAgo: 24,
  },
  {
    ownerKey: "smk",
    title: "Tim panahan membawa pulang juara kabupaten",
    slug: "tim-panahan-juara-kabupaten",
    summary: "Enam santri turun di tiga kategori dan menutup lomba dengan satu emas.",
    body: "Kejuaraan panahan pelajar tingkat kabupaten berlangsung dua hari di lapangan terbuka, diikuti enam santri pada tiga kategori.\n\nPada hari pertama, dua santri lolos ke babak eliminasi setelah menuntaskan babak kualifikasi. Babak final berjalan pada hari kedua.\n\nPembina menyebut latihan rutin Rabu sore dan tambahan sesi akhir pekan sebagai dasar capaian ini.",
    attribution: HUMAS("SMK Terpadu Madina"),
    daysAgo: 4,
  },
  {
    ownerKey: "smk",
    title: "Praktik industri angkatan TKJ dimulai pekan ini",
    slug: "praktik-industri-angkatan-tkj",
    summary: "Siswa kelas XI ditempatkan di mitra industri di Samarinda.",
    body: "Praktik industri untuk siswa kelas XI jurusan Teknik Komputer dan Jaringan dimulai pekan ini.\n\nPenempatan diatur bersama mitra industri di Samarinda, dengan pembekalan keselamatan kerja dan etika kerja sebelum keberangkatan.\n\nGuru pembimbing memantau tiap siswa selama penempatan dan mencatat capaian kompetensinya.",
    attribution: HUMAS("SMK Terpadu Madina"),
    daysAgo: 17,
  },
  {
    ownerKey: "sma",
    title: "Tim debat menuju seleksi tingkat provinsi",
    slug: "tim-debat-seleksi-provinsi",
    summary: "Tim inti disiapkan setelah seleksi internal dua babak.",
    body: "Tim debat bahasa Inggris menuntaskan seleksi internal dua babak dan menetapkan tim inti untuk seleksi tingkat provinsi.\n\nLatihan difokuskan pada penyusunan argumen dan manajemen waktu bicara, dengan simulasi penuh tiap akhir pekan.\n\nSeleksi provinsi dijadwalkan pada bulan depan.",
    attribution: HUMAS("SMA Madina Citra Insani"),
    daysAgo: 7,
  },
  {
    ownerKey: "sma",
    title: "Praktik laboratorium terpadu dimulai semester ini",
    slug: "praktik-laboratorium-terpadu",
    summary: "Biologi, kimia, dan fisika berjalan di satu ruang praktik.",
    body: "Praktik laboratorium terpadu mulai berjalan semester ini untuk mata pelajaran biologi, kimia, dan fisika.\n\nSetiap kelompok kerja menerima lembar kerja dan penjelasan keselamatan sebelum praktik dimulai.\n\nPenyimpanan bahan dipisahkan dari ruang kerja dan hanya dibuka oleh guru mata pelajaran.",
    attribution: HUMAS("SMA Madina Citra Insani"),
    daysAgo: 19,
  },
];

export const PENGUMUMAN_ENTRY_SEED: ArticleSeed[] = [
  {
    ownerKey: "mbs",
    title: "Jadwal libur dan layanan sekretariat",
    slug: "jadwal-libur-layanan-sekretariat",
    summary: "Sekretariat yayasan tutup pada tanggal merah nasional.",
    body: "Sekretariat yayasan mengikuti tanggal merah nasional dan tutup pada hari libur.\n\nDi luar hari tersebut, layanan berjalan pada jam kerja. Pertanyaan pendaftaran tetap dijawab panitia lewat WhatsApp.",
    attribution: "Sekretariat Yayasan",
    daysAgo: 2,
    expiresInDays: 45,
  },
  {
    ownerKey: "smp",
    title: "Perubahan jam layanan tata usaha",
    slug: "perubahan-jam-layanan-tata-usaha",
    summary: "Layanan tata usaha tutup lebih awal selama bulan ini.",
    body: "Layanan tata usaha tutup pukul 14.00 selama bulan ini dan kembali ke jam biasa setelahnya.\n\nPengambilan surat dan berkas dapat diurus pada jam tersebut. Di luar jam itu, hubungi humas sekolah lewat WhatsApp.",
    attribution: HUMAS("SMP Islam Terpadu Madina"),
    daysAgo: 3,
    expiresInDays: 30,
  },
  {
    ownerKey: "smk",
    title: "Jadwal seleksi gelombang pertama",
    slug: "jadwal-seleksi-gelombang-pertama",
    summary: "Seleksi berlangsung tiga hari di kampus utama.",
    body: "Seleksi gelombang pertama berlangsung tiga hari di kampus utama.\n\nPeserta membawa kartu peserta dan alat tulis sendiri. Tanggal, biaya, dan status pendaftaran yang berlaku selalu dibaca dari halaman pendaftaran, bukan dari pengumuman ini.",
    attribution: "Panitia Pendaftaran",
    daysAgo: 1,
    expiresInDays: 30,
  },
  {
    ownerKey: "sma",
    title: "Pengambilan rapor semester ganjil",
    slug: "pengambilan-rapor-semester-ganjil",
    summary: "Rapor diambil orang tua/wali di kelas masing-masing.",
    body: "Pengambilan rapor semester ganjil dilakukan orang tua/wali di kelas masing-masing sesuai jadwal yang dibagikan wali kelas.\n\nBila berhalangan hadir, pengambilan dapat diwakilkan dengan surat kuasa sederhana.",
    attribution: HUMAS("SMA Madina Citra Insani"),
    daysAgo: 5,
    expiresInDays: 21,
  },
];
