/**
 * The blocks each owner's `/pendaftaran` page starts with.
 *
 * The page itself draws the status, the dates, the fee, the documents and the
 * five steps — all of those are read from the admission system, and an editor
 * cannot restate them. What is seeded here is the part an editor does own: the
 * questions families actually ask, and room for a paragraph of their own words.
 *
 * Answers are placeholders with the right shape, like every other seed. The
 * committee replaces them; the seed never overwrites what an editor wrote.
 */

import type { Modules } from "@strapi/strapi";

import type { OwnerKey } from "./home-page";

type Block = NonNullable<Modules.Documents.Params.Data.Input<"api::page.page">["blocks"]>[number];

export type AdmissionSeed = { title: string; blocks: Block[] };

const faq = (description: string, items: { question: string; answer: string }[]): Block => ({
  __component: "blocks.faq",
  // No link on this head: the answer to a question here is the answer, not a
  // trip to another page.
  head: { heading: "Pertanyaan yang sering masuk", description },
  items,
});

const SHARED_ANSWERS = [
  {
    question: "Apakah pengisian bisa dicicil?",
    answer:
      "Bisa. Data tersimpan sebagai draf dan bisa dilanjutkan dari perangkat mana pun dengan akun yang sama.",
  },
  {
    question: "Satu akun untuk dua anak, bagaimana?",
    answer: "Satu akun bisa membuat satu aplikasi untuk setiap anak.",
  },
  {
    question: "Apa yang terjadi setelah pembayaran?",
    answer:
      "Pembayaran yang berhasil belum mengirim aplikasi. Pengiriman dilakukan terpisah oleh orang tua/wali.",
  },
];

const schoolAdmission = (name: string): AdmissionSeed => ({
  title: `Pendaftaran ${name}`,
  blocks: [
    faq("Ditulis dan diperbarui panitia lewat CMS. Ganti jawaban di bawah ini.", SHARED_ANSWERS),
  ],
});

export const ADMISSION_SEED: Record<OwnerKey, AdmissionSeed> = {
  mbs: {
    title: "Pendaftaran Bersama Madina Boarding School",
    blocks: [
      faq("Pertanyaan khusus tiap sekolah dijawab di halaman pendaftaran sekolah.", [
        {
          question: "Bisakah mendaftar ke dua sekolah sekaligus?",
          answer: "Bisa. Buat satu aplikasi per anak per sekolah dari akun yang sama.",
        },
        ...SHARED_ANSWERS.slice(1),
      ]),
    ],
  },
  smp: schoolAdmission("SMP Islam Terpadu Madina"),
  smk: schoolAdmission("SMK Terpadu Madina"),
  sma: schoolAdmission("SMA Madina Citra Insani"),
};
