import { serverNow } from "@mbs/api-client/http";
import type { ActorType, FamilyApplication, FamilyCommand, FamilyStage } from "@mbs/api-contract";

import { formatDateTime, formatFee, formatList, schoolName } from "./format.ts";

export const TURNS = {
  FAMILY: "Giliran kamu",
  COMMITTEE: "Giliran panitia",
  NOBODY: "Selesai",
} as const;

export const MILESTONES = [
  "Pendaftaran",
  "Pembayaran",
  "Dokumen",
  "Seleksi berkas",
  "Wawancara",
  "Pengumuman",
  "Daftar ulang",
] as const;
type Milestone = (typeof MILESTONES)[number];

type StageCopy = {
  turn: keyof typeof TURNS;
  title: string;
  /** Where it is on the road, or null at the end of it. */
  at: Milestone | null;
  next: (application: FamilyApplication) => string;
};

const WAIT = "Kamu tidak perlu melakukan apa-apa dulu. Kami kabari lewat email.";

/** What each stage says to the family. Where a step is not built yet, it says so. */
export const STAGE_COPY: Record<FamilyStage, StageCopy> = {
  PAYMENT_DUE: {
    turn: "FAMILY",
    title: "Menunggu pembayaran",
    at: "Pembayaran",
    next: (application) => {
      if (sentBack(application, "REJECT_PAYMENT")) {
        return "Bukti transfer perlu diunggah ulang. Tempat mengunggahnya akan muncul di halaman ini. Jangan transfer lagi.";
      }
      return application.registrationFee === 0
        ? "Tidak ada biaya pendaftaran. Langkah berikutnya akan muncul di halaman ini."
        : `Biaya pendaftaran ${formatFee(application.registrationFee)}. Rekening tujuan akan muncul di halaman ini. Jangan transfer dulu.`;
    },
  },
  PAYMENT_REVIEW: {
    turn: "COMMITTEE",
    title: "Panitia memeriksa pembayaran",
    at: "Pembayaran",
    next: () => WAIT,
  },
  DOCUMENTS_DUE: {
    turn: "FAMILY",
    title: "Menunggu dokumen",
    at: "Dokumen",
    next: (application) =>
      sentBack(application, "REQUEST_DOCUMENT_FIX")
        ? "Ada dokumen yang perlu diperbaiki. Tempat mengunggahnya akan muncul di halaman ini."
        : documentsToPrepare(application.documents),
  },
  DOCUMENTS_REVIEW: {
    turn: "COMMITTEE",
    title: "Panitia memeriksa dokumen",
    at: "Dokumen",
    next: () => WAIT,
  },
  SCREENING: {
    turn: "COMMITTEE",
    title: "Panitia menyeleksi berkas",
    at: "Seleksi berkas",
    next: () => WAIT,
  },
  INTERVIEW_PENDING: {
    turn: "COMMITTEE",
    title: "Menunggu jadwal wawancara",
    at: "Wawancara",
    next: () => "Panitia sedang menyusun jadwalnya. Kami kabari lewat email.",
  },
  INTERVIEW_SCHEDULED: {
    turn: "FAMILY",
    title: "Wawancara sudah dijadwalkan",
    at: "Wawancara",
    next: () => "Waktu dan tempatnya akan muncul di halaman ini.",
  },
  INTERVIEWED: {
    turn: "COMMITTEE",
    title: "Menunggu pengumuman",
    at: "Pengumuman",
    next: ({ resultPublishAt }) =>
      // Once that time has passed, a date would read as a broken promise.
      Date.parse(resultPublishAt) > serverNow().getTime()
        ? `Wawancara sudah selesai. Hasilnya diumumkan di halaman ini pada ${formatDateTime(resultPublishAt)}.`
        : "Wawancara sudah selesai. Hasilnya akan muncul di halaman ini.",
  },
  REREGISTRATION: {
    turn: "FAMILY",
    title: "Diterima, menunggu daftar ulang",
    at: "Daftar ulang",
    next: (application) =>
      sentBack(application, "REQUEST_REREGISTRATION_FIX")
        ? "Ada bagian daftar ulang yang perlu diperbaiki. Caranya akan muncul di halaman ini."
        : `Selamat, ${application.childName} diterima di ${schoolName(application.schoolKey)}. Cara daftar ulang akan muncul di halaman ini.`,
  },
  REREGISTRATION_REVIEW: {
    turn: "COMMITTEE",
    title: "Panitia memeriksa daftar ulang",
    at: "Daftar ulang",
    next: () => WAIT,
  },
  ENROLLED: {
    turn: "NOBODY",
    title: "Resmi terdaftar",
    at: null,
    next: ({ childName, schoolKey }) =>
      `${childName} sudah resmi menjadi siswa ${schoolName(schoolKey)}. Sekolah akan menghubungi kamu soal langkah berikutnya.`,
  },
  NOT_ADVANCED: {
    turn: "NOBODY",
    title: "Tidak lanjut ke wawancara",
    at: null,
    next: ({ childName, schoolKey }) =>
      `Mohon maaf, pendaftaran ${childName} berhenti di seleksi berkas. Kalau ada yang ingin kamu tanyakan, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
  },
  NOT_ACCEPTED: {
    turn: "NOBODY",
    title: "Belum diterima",
    at: null,
    next: ({ childName, schoolKey }) =>
      `Mohon maaf, ${childName} belum diterima di ${schoolName(schoolKey)}. Terima kasih sudah mendaftar. Kalau ada yang ingin kamu tanyakan, hubungi panitia PPDB.`,
  },
  WITHDRAWN: {
    turn: "NOBODY",
    title: "Pendaftaran dibatalkan",
    at: null,
    next: ({ schoolKey }) =>
      `Kalau kamu tidak merasa membatalkannya, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
  },
};

type EventCopy = {
  title: string | ((actor: ActorType) => string);
  /** The milestone this event finishes. */
  finishes?: Milestone;
};

export const EVENT_COPY: Record<FamilyCommand, EventCopy> = {
  SUBMIT: { title: "Pendaftaran dikirim", finishes: "Pendaftaran" },
  UPLOAD_PAYMENT_PROOF: { title: "Bukti transfer dikirim" },
  APPROVE_PAYMENT: { title: "Pembayaran dikonfirmasi", finishes: "Pembayaran" },
  REJECT_PAYMENT: { title: "Bukti transfer perlu diunggah ulang" },
  SUBMIT_DOCUMENTS: { title: "Dokumen dikirim" },
  REQUEST_DOCUMENT_FIX: { title: "Dokumen perlu diperbaiki" },
  VERIFY_DOCUMENTS: { title: "Dokumen lengkap", finishes: "Dokumen" },
  ADVANCE_TO_INTERVIEW: { title: "Lanjut ke wawancara", finishes: "Seleksi berkas" },
  STOP_AT_SCREENING: { title: "Tidak lanjut ke wawancara", finishes: "Seleksi berkas" },
  SCHEDULE_INTERVIEW: { title: "Wawancara dijadwalkan" },
  RESCHEDULE_INTERVIEW: { title: "Jadwal wawancara berubah" },
  RECORD_ATTENDED: { title: "Wawancara selesai", finishes: "Wawancara" },
  RECORD_NO_SHOW: { title: "Tercatat tidak hadir di wawancara" },
  PUBLISH_ACCEPTED: { title: "Diterima", finishes: "Pengumuman" },
  PUBLISH_NOT_ACCEPTED: { title: "Belum diterima", finishes: "Pengumuman" },
  SUBMIT_REREGISTRATION: { title: "Daftar ulang dikirim" },
  REQUEST_REREGISTRATION_FIX: { title: "Daftar ulang perlu diperbaiki" },
  CONFIRM_ENROLLMENT: { title: "Resmi terdaftar", finishes: "Daftar ulang" },
  WITHDRAW: { title: by("Pendaftaran dibatalkan") },
  CHANGE_INTERVIEW_MODE: { title: by("Cara wawancara diganti") },
  EDIT_PROFILE: { title: by("Data pendaftaran diubah") },
};

/** Both sides can do these, so the line says who did. */
function by(title: string) {
  return (actor: ActorType) => (actor === "STAFF" ? `${title} oleh panitia` : title);
}

function sentBack({ events }: FamilyApplication, command: FamilyCommand) {
  return events.at(-1)?.command === command;
}

const DOCUMENT_LABELS: Record<FamilyApplication["documents"][number]["type"], string> = {
  KARTU_KELUARGA: "kartu keluarga",
  AKTA_KELAHIRAN: "akta kelahiran",
  KARTU_IDENTITAS_ANAK: "Kartu Identitas Anak (KIA)",
  IJAZAH: "ijazah atau surat keterangan lulus",
};

function documentsToPrepare(documents: FamilyApplication["documents"]) {
  const labels = (required: boolean) =>
    formatList(
      documents
        .filter((document) => document.required === required)
        .map(({ type }) => DOCUMENT_LABELS[type]),
    );
  const required = labels(true);
  const optional = labels(false);
  return [
    required && `Siapkan ${required}.`,
    optional && `Kalau ada, siapkan juga ${optional}.`,
    documents.length > 0
      ? "Tempat mengunggahnya akan muncul di halaman ini."
      : "Daftar dokumennya akan muncul di halaman ini.",
  ]
    .filter(Boolean)
    .join(" ");
}
