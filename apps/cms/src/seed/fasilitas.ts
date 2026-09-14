/**
 * The facilities each school starts with.
 *
 * **Development only**, same reason and same rules as the activities beside
 * them: the home page draws a facilities section from these records and renders
 * nothing without them, and a seeded building on a live site is a claim that it
 * exists. `index.ts` skips every content seed when `NODE_ENV` is production.
 *
 * The umbrella has no facilities of its own — every building belongs to one of
 * the three schools — so it has no entry here.
 */

import type { EntrySeed } from "./ekstrakurikuler";
import type { OwnerKey } from "./home-page";

const shared = (ownerKey: OwnerKey): EntrySeed[] => [
  {
    ownerKey,
    title: "Asrama santri",
    slug: "asrama-santri",
    summary: "Asrama putra dan putri terpisah, dengan pembina yang tinggal di dalam.",
    body: "Asrama putra dan putri berdiri terpisah, masing-masing dengan pembina yang tinggal bersama santri dan mendampingi kegiatan harian dari bangun tidur sampai belajar malam.\n\nSetiap kamar dihuni beberapa santri dengan lemari dan meja belajar masing-masing. Kebersihan kamar dijadwalkan bergilir.",
  },
  {
    ownerKey,
    title: "Masjid kampus",
    slug: "masjid-kampus",
    summary: "Pusat kegiatan ibadah, tahfiz, dan kajian rutin.",
    body: "Masjid kampus menjadi pusat kegiatan ibadah sekaligus ruang tahfiz dan kajian rutin.\n\nSalat lima waktu dijalankan berjamaah, dengan santri bergiliran sebagai muazin dan imam pada waktu tertentu.",
  },
  {
    ownerKey,
    title: "Perpustakaan",
    slug: "perpustakaan",
    summary: "Koleksi rujukan pelajaran, keislaman, dan bacaan umum.",
    body: "Perpustakaan menyimpan koleksi rujukan pelajaran, keislaman, dan bacaan umum, serta menyediakan ruang baca yang dipakai untuk belajar mandiri.\n\nPeminjaman dicatat oleh petugas perpustakaan dan terbuka pada jam sekolah.",
  },
  {
    ownerKey,
    title: "Laboratorium komputer",
    slug: "laboratorium-komputer",
    summary: "Ruang praktik dengan komputer kerja dan jaringan lokal.",
    body: "Laboratorium komputer dipakai untuk pelajaran informatika, praktik, dan kegiatan robotik.\n\nSetiap unit terhubung ke jaringan lokal sekolah, dan akses internet dibatasi menurut jadwal pelajaran.",
  },
  {
    ownerKey,
    title: "Lapangan serbaguna",
    slug: "lapangan-serbaguna",
    summary: "Dipakai untuk olahraga, upacara, dan kegiatan kampus.",
    body: "Lapangan serbaguna dipakai untuk pelajaran olahraga, latihan ekstrakurikuler, upacara, dan kegiatan besar kampus.\n\nJadwal pemakaian diatur bergilir antara kegiatan kelas dan kegiatan asrama.",
  },
];

export const FASILITAS_SEED: EntrySeed[] = [
  ...shared("smp"),
  {
    ownerKey: "smp",
    title: "Laboratorium IPA",
    slug: "laboratorium-ipa",
    summary: "Ruang praktik biologi dan fisika dasar.",
    body: "Laboratorium IPA dipakai untuk praktik biologi dan fisika dasar, dengan peralatan yang disiapkan per kelompok kerja.\n\nSetiap praktik didampingi guru mata pelajaran dan diawali penjelasan keselamatan kerja.",
  },
  ...shared("smk"),
  {
    ownerKey: "smk",
    title: "Bengkel otomotif",
    slug: "bengkel-otomotif",
    summary: "Unit praktik kendaraan ringan untuk kelas XI dan XII.",
    body: "Bengkel otomotif dipakai jurusan Teknik Kendaraan Ringan untuk praktik perawatan dan perbaikan kendaraan roda empat.\n\nPraktik berjalan per kelompok kecil dengan pembagian unit kerja, didampingi guru produktif.",
  },
  {
    ownerKey: "smk",
    title: "Dapur praktik tata boga",
    slug: "dapur-praktik-tata-boga",
    summary: "Dapur produksi dengan alur kerja dan standar higienitas.",
    body: "Dapur praktik dipakai jurusan Tata Boga untuk produksi makanan, layanan, dan penerapan standar higienitas dapur.\n\nAlur kerja disusun seperti dapur produksi, dari persiapan bahan sampai penyajian dan pembersihan.",
  },
  ...shared("sma"),
  {
    ownerKey: "sma",
    title: "Laboratorium IPA terpadu",
    slug: "laboratorium-ipa-terpadu",
    summary: "Ruang praktik biologi, kimia, dan fisika.",
    body: "Laboratorium IPA terpadu dipakai untuk praktik biologi, kimia, dan fisika, dengan penyimpanan bahan yang terkunci dan terpisah dari ruang kerja.\n\nSetiap praktik didampingi guru mata pelajaran dan diawali penjelasan keselamatan kerja.",
  },
];
