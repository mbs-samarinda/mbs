import { serverNow } from "@mbs/api-client/http";
import type { ActorType, FamilyApplication, FamilyCommand, FamilyStage } from "@mbs/api-contract";
import type { Milestone } from "@mbs/school-config";

import { formatDateTime, formatFee, formatList, schoolName } from "./format.ts";

export const TURNS = {
  FAMILY: "Giliran kamu",
  COMMITTEE: "Giliran panitia",
  NOBODY: "Selesai",
} as const;

export const MILESTONE_LABELS: Record<Milestone, string> = {
  REGISTRATION: "Pendaftaran",
  PAYMENT: "Pembayaran",
  DOCUMENTS: "Dokumen",
  SCREENING: "Seleksi berkas",
  INTERVIEW: "Wawancara",
  ANNOUNCEMENT: "Pengumuman",
  REREGISTRATION: "Daftar ulang",
};

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
    at: "PAYMENT",
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
    at: "PAYMENT",
    next: () => WAIT,
  },
  DOCUMENTS_DUE: {
    turn: "FAMILY",
    title: "Menunggu dokumen",
    at: "DOCUMENTS",
    next: (application) =>
      sentBack(application, "REQUEST_DOCUMENT_FIX")
        ? "Ada dokumen yang perlu diperbaiki. Tempat mengunggahnya akan muncul di halaman ini."
        : documentsToPrepare(application.documents),
  },
  DOCUMENTS_REVIEW: {
    turn: "COMMITTEE",
    title: "Panitia memeriksa dokumen",
    at: "DOCUMENTS",
    next: () => WAIT,
  },
  SCREENING: {
    turn: "COMMITTEE",
    title: "Panitia menyeleksi berkas",
    at: "SCREENING",
    next: () => WAIT,
  },
  INTERVIEW_PENDING: {
    turn: "COMMITTEE",
    title: "Menunggu jadwal wawancara",
    at: "INTERVIEW",
    next: () => "Panitia sedang menyusun jadwalnya. Kami kabari lewat email.",
  },
  INTERVIEW_SCHEDULED: {
    turn: "FAMILY",
    title: "Wawancara sudah dijadwalkan",
    at: "INTERVIEW",
    next: () => "Waktu dan tempatnya akan muncul di halaman ini.",
  },
  INTERVIEWED: {
    turn: "COMMITTEE",
    title: "Menunggu pengumuman",
    at: "ANNOUNCEMENT",
    next: ({ resultPublishAt }) =>
      // Once that time has passed, a date would read as a broken promise.
      Date.parse(resultPublishAt) > serverNow().getTime()
        ? `Wawancara sudah selesai. Hasilnya diumumkan di halaman ini pada ${formatDateTime(resultPublishAt)}.`
        : "Wawancara sudah selesai. Hasilnya akan muncul di halaman ini.",
  },
  REREGISTRATION: {
    turn: "FAMILY",
    title: "Diterima, menunggu daftar ulang",
    at: "REREGISTRATION",
    next: (application) =>
      sentBack(application, "REQUEST_REREGISTRATION_FIX")
        ? "Ada bagian daftar ulang yang perlu diperbaiki. Caranya akan muncul di halaman ini."
        : `Selamat, ${application.childName} diterima di ${schoolName(application.schoolKey)}. Cara daftar ulang akan muncul di halaman ini.`,
  },
  REREGISTRATION_REVIEW: {
    turn: "COMMITTEE",
    title: "Panitia memeriksa daftar ulang",
    at: "REREGISTRATION",
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

export const EVENT_TITLES: Record<FamilyCommand, string | ((actor: ActorType) => string)> = {
  SUBMIT: "Pendaftaran dikirim",
  UPLOAD_PAYMENT_PROOF: "Bukti transfer dikirim",
  APPROVE_PAYMENT: "Pembayaran dikonfirmasi",
  REJECT_PAYMENT: "Bukti transfer perlu diunggah ulang",
  SUBMIT_DOCUMENTS: "Dokumen dikirim",
  REQUEST_DOCUMENT_FIX: "Dokumen perlu diperbaiki",
  VERIFY_DOCUMENTS: "Dokumen lengkap",
  ADVANCE_TO_INTERVIEW: "Lanjut ke wawancara",
  STOP_AT_SCREENING: "Tidak lanjut ke wawancara",
  SCHEDULE_INTERVIEW: "Wawancara dijadwalkan",
  RESCHEDULE_INTERVIEW: "Jadwal wawancara berubah",
  RECORD_ATTENDED: "Wawancara selesai",
  RECORD_NO_SHOW: "Tercatat tidak hadir di wawancara",
  PUBLISH_ACCEPTED: "Diterima",
  PUBLISH_NOT_ACCEPTED: "Belum diterima",
  SUBMIT_REREGISTRATION: "Daftar ulang dikirim",
  REQUEST_REREGISTRATION_FIX: "Daftar ulang perlu diperbaiki",
  CONFIRM_ENROLLMENT: "Resmi terdaftar",
  WITHDRAW: by("Pendaftaran dibatalkan"),
  CHANGE_INTERVIEW_MODE: by("Cara wawancara diganti"),
  EDIT_PROFILE: by("Data pendaftaran diubah"),
};

/** Both sides can do these, so the line says who did. */
function by(title: string) {
  return (actor: ActorType) => (actor === "STAFF" ? `${title} oleh panitia` : title);
}

/** Both can happen at any stage, and neither is why the application is where it is. */
const CHANGES_NO_STAGE = new Set<FamilyCommand>(["EDIT_PROFILE", "CHANGE_INTERVIEW_MODE"]);

/** The event the family's next step follows from. */
export function newestMove({ events }: FamilyApplication) {
  return events.findLast(({ command }) => !CHANGES_NO_STAGE.has(command));
}

function sentBack(application: FamilyApplication, command: FamilyCommand) {
  return newestMove(application)?.command === command;
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
