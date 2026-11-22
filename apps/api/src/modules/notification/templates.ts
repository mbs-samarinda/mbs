import { SCHOOLS, SIGN_IN_CODE_TEMPLATE, type SchoolKey } from "@mbs/school-config";

import type { NotificationKey } from "../application/stages.ts";

export type EventTemplateKey = NotificationKey;
export type TemplateKey = EventTemplateKey | typeof SIGN_IN_CODE_TEMPLATE;

/** What every application email is written from. */
export type EventMailInput = {
  childName: string;
  schoolKey: SchoolKey;
  registrationNumber: string;
  /** The reason staff gave, on rejections, fixes, stops and withdrawals. */
  reason: string | null;
  /** The parent app, where every next step happens. */
  appUrl: string;
};

export type SignInCodeInput = { code: string; minutes: number };

type TemplateInput<K extends TemplateKey> = K extends typeof SIGN_IN_CODE_TEMPLATE
  ? SignInCodeInput
  : EventMailInput;

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * `version` is stored on every notification row. Bump it whenever the copy
 * changes, so the record says which wording a family received.
 */
type Template<I> = { version: number; render: (input: I) => RenderedEmail };

/** What one application email says: the news, then the one next step. */
type EventCopy = { subject: string; happened: string; next: string };

function eventTemplate(version: number, copy: (input: EventMailInput) => EventCopy) {
  return {
    version,
    render: (input: EventMailInput) => {
      const { subject, happened, next } = copy(input);
      const school = schoolName(input.schoolKey);
      return layout({
        subject: `${subject} (${input.registrationNumber})`,
        greeting: `Halo, orang tua/wali ${input.childName}.`,
        paragraphs: [
          happened,
          ...(input.reason ? [`Catatan dari panitia: ${input.reason}`] : []),
          next,
          `Nomor pendaftaran: ${input.registrationNumber}`,
        ],
        action: { label: "Buka halaman pendaftaran", url: input.appUrl },
        signature: `Panitia PPDB ${school}`,
      });
    },
  } satisfies Template<EventMailInput>;
}

/**
 * Every email PPDB sends. Copy follows `bahasa-indonesia-plain`: the reader is
 * "kamu", the role is "orang tua/wali", and each email says what happened and
 * what to do next. Keyed by template, so a notification key added to
 * TRANSITIONS without a template here fails to compile.
 */
export const TEMPLATES: { [K in TemplateKey]: Template<TemplateInput<K>> } = {
  "application-submitted": eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: `Pendaftaran ${childName} sudah kami terima`,
    happened: `Pendaftaran ${childName} di ${schoolName(schoolKey)} sudah kami terima.`,
    next: "Sekarang kamu bisa membayar biaya pendaftaran lewat transfer bank. Setelah itu, unggah foto bukti transfernya.",
  })),
  "payment-received": eventTemplate(1, ({ childName }) => ({
    subject: "Bukti transfer sudah kami terima",
    happened: `Bukti transfer untuk ${childName} sudah kami terima.`,
    next: "Panitia akan memeriksanya. Kamu tidak perlu melakukan apa-apa dulu. Kami kabari lagi lewat email.",
  })),
  "payment-approved": eventTemplate(1, ({ childName }) => ({
    subject: "Pembayaran sudah dikonfirmasi",
    happened: `Pembayaran biaya pendaftaran ${childName} sudah dikonfirmasi panitia.`,
    next: "Sekarang kamu bisa mengunggah dokumen yang diminta dan memilih cara wawancara.",
  })),
  "payment-rejected": eventTemplate(1, ({ childName }) => ({
    subject: "Bukti transfer perlu diunggah ulang",
    happened: `Bukti transfer untuk ${childName} belum bisa dikonfirmasi panitia.`,
    next: "Kamu perlu mengunggah ulang bukti transfer sesuai catatan di atas.",
  })),
  "documents-received": eventTemplate(1, ({ childName }) => ({
    subject: "Dokumen sudah kami terima",
    happened: `Dokumen ${childName} sudah kami terima.`,
    next: "Panitia akan memeriksanya. Kamu tidak perlu melakukan apa-apa dulu. Kami kabari lagi lewat email.",
  })),
  "documents-need-fix": eventTemplate(1, ({ childName }) => ({
    subject: "Ada dokumen yang perlu diperbaiki",
    happened: `Ada dokumen ${childName} yang perlu diperbaiki.`,
    next: "Kamu cukup mengunggah ulang dokumen yang diminta. Dokumen lain tidak perlu diunggah lagi.",
  })),
  "documents-verified": eventTemplate(1, ({ childName }) => ({
    subject: "Dokumen sudah lengkap",
    happened: `Dokumen ${childName} sudah diperiksa dan lengkap.`,
    next: "Panitia sedang menyeleksi pendaftaran. Kamu tidak perlu melakukan apa-apa dulu. Kami kabari hasilnya lewat email.",
  })),
  "advanced-to-interview": eventTemplate(1, ({ childName }) => ({
    subject: "Lanjut ke tahap wawancara",
    happened: `${childName} lanjut ke tahap wawancara.`,
    next: "Panitia akan mengirim jadwalnya. Sampai jadwal dibuat, kamu masih bisa mengganti pilihan wawancara tatap muka atau daring.",
  })),
  "stopped-at-screening": eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: "Hasil seleksi pendaftaran",
    happened: `Mohon maaf, pendaftaran ${childName} tidak lanjut ke tahap wawancara.`,
    next: `Kalau ada yang ingin kamu tanyakan, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
  })),
  "interview-scheduled": eventTemplate(1, ({ childName }) => ({
    subject: "Jadwal wawancara sudah dibuat",
    happened: `Jadwal wawancara ${childName} sudah dibuat.`,
    next: "Kamu bisa melihat jadwal lengkapnya di halaman pendaftaran.",
  })),
  "interview-rescheduled": eventTemplate(1, ({ childName }) => ({
    subject: "Jadwal wawancara berubah",
    happened: `Jadwal wawancara ${childName} berubah.`,
    next: "Kamu bisa melihat jadwal barunya di halaman pendaftaran.",
  })),
  "interview-missed": eventTemplate(1, ({ childName }) => ({
    subject: "Wawancara akan dijadwalkan ulang",
    happened: `${childName} tercatat tidak hadir di wawancara.`,
    next: "Panitia akan membuat jadwal baru dan mengabari kamu lewat email.",
  })),
  "result-accepted": eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: `Selamat, ${childName} diterima`,
    happened: `Selamat, ${childName} diterima di ${schoolName(schoolKey)}.`,
    next: "Langkah berikutnya adalah registrasi ulang. Kamu perlu membayar biayanya, mengunggah dokumen tambahan, dan menyetujui ketentuan sekolah.",
  })),
  "result-not-accepted": eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: "Hasil pendaftaran",
    happened: `Mohon maaf, ${childName} belum diterima di ${schoolName(schoolKey)}.`,
    next: `Terima kasih sudah mendaftar. Kalau ada yang ingin kamu tanyakan, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
  })),
  "reregistration-received": eventTemplate(1, ({ childName }) => ({
    subject: "Registrasi ulang sudah kami terima",
    happened: `Registrasi ulang ${childName} sudah kami terima.`,
    next: "Panitia akan memeriksanya. Kamu tidak perlu melakukan apa-apa dulu. Kami kabari lagi lewat email.",
  })),
  "reregistration-needs-fix": eventTemplate(1, ({ childName }) => ({
    subject: "Registrasi ulang perlu diperbaiki",
    happened: `Ada bagian registrasi ulang ${childName} yang perlu diperbaiki.`,
    next: "Kamu perlu memperbaiki bagian yang diminta, lalu mengirimnya lagi.",
  })),
  enrolled: eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: `${childName} sudah resmi terdaftar`,
    happened: `${childName} sudah resmi terdaftar sebagai siswa ${schoolName(schoolKey)}.`,
    next: "Sekolah akan menghubungi kamu soal langkah berikutnya.",
  })),
  withdrawn: eventTemplate(1, ({ childName, schoolKey }) => ({
    subject: "Pendaftaran dibatalkan",
    happened: `Pendaftaran ${childName} di ${schoolName(schoolKey)} sudah dibatalkan.`,
    next: `Kalau kamu tidak merasa membatalkannya, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
  })),
  [SIGN_IN_CODE_TEMPLATE]: {
    version: 1,
    render: ({ code, minutes }) =>
      layout({
        subject: `Kode masuk PPDB MBSS: ${code}`,
        greeting: "Halo,",
        paragraphs: [
          `Kode masuk kamu: ${code}`,
          `Kode ini berlaku ${minutes} menit. Jangan berikan kode ini kepada siapa pun, termasuk panitia.`,
          "Kalau kamu tidak meminta kode ini, abaikan email ini. Akun kamu tetap aman.",
        ],
        action: null,
        signature: "Panitia PPDB MBSS",
      }),
  },
};

function schoolName(key: SchoolKey) {
  return SCHOOLS.find((school) => school.key === key)!.name;
}

const PRIMARY = "#126e84";
const MUTED = "#525252";

/**
 * Plain text and a small HTML version of the same words. Inline styles only,
 * because mail clients drop style sheets. Everything interpolated is escaped:
 * names and reasons are typed by people.
 */
function layout(mail: {
  subject: string;
  greeting: string;
  paragraphs: string[];
  action: { label: string; url: string } | null;
  signature: string;
}): RenderedEmail {
  const text = [
    mail.greeting,
    ...mail.paragraphs,
    ...(mail.action ? [`${mail.action.label}: ${mail.action.url}`] : []),
    mail.signature,
  ].join("\n\n");

  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escape(value)}</p>`;
  const html = [
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(mail.subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:#ffffff;color:#171717;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">`,
    `<div style="max-width:480px;margin:0 auto;">`,
    paragraph(mail.greeting),
    ...mail.paragraphs.map(paragraph),
    mail.action
      ? `<p style="margin:24px 0;"><a href="${escape(mail.action.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${PRIMARY};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">${escape(mail.action.label)}</a></p>`
      : "",
    `<p style="margin:24px 0 0;font-size:14px;line-height:20px;color:${MUTED};">${escape(mail.signature)}</p>`,
    `</div></body></html>`,
  ].join("");

  return { subject: mail.subject, text, html };
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
