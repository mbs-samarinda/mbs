import type {
  ActivityItem,
  ApplicationCommand,
  ApplicationStage,
  AuditActor,
  DocumentType,
  HistoryItem,
} from "@mbs/api-contract";
import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { cn } from "cn";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CalendarClockIcon,
  CalendarXIcon,
  CheckIcon,
  FileTextIcon,
  GraduationCapIcon,
  LockIcon,
  MegaphoneIcon,
  PencilIcon,
  RepeatIcon,
  ScaleIcon,
  UndoIcon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatStamp, initials } from "./format.ts";

// What the committee app shows of an application, in one place: school marks,
// stage labels, and the words and icons for every event.

/** Literal class names, because Tailwind only finds classes written out whole. */
const SCHOOL_STYLE: Record<SchoolKey, { tile: string; mark: string }> = {
  smp: { tile: "bg-school-smp-tint text-school-smp", mark: "bg-school-smp" },
  smk: { tile: "bg-school-smk-tint text-school-smk", mark: "bg-school-smk" },
  sma: { tile: "bg-school-sma-tint text-school-sma", mark: "bg-school-sma" },
};

export function schoolShortName(key: SchoolKey) {
  return SCHOOLS.find((school) => school.key === key)!.shortName;
}

export function schoolMarkClass(key: SchoolKey) {
  return SCHOOL_STYLE[key].mark;
}

/** A square initials tile. Square, because the brand keeps full rounding for badges. */
export function Tile({
  name,
  school,
  size = "md",
}: {
  name: string;
  school?: SchoolKey;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-semibold",
        school ? SCHOOL_STYLE[school].tile : "bg-background text-muted-foreground",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-14 text-lg",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function SchoolMark({ school }: { school: SchoolKey }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-[2px]", SCHOOL_STYLE[school].mark)}
      />
      <span className="truncate">{schoolShortName(school)}</span>
    </span>
  );
}

type Tone = "warning" | "info" | "success" | "muted";

/** The committee's words for each stage. A waiting stage reads as the job to do. */
const STAGES: Record<ApplicationStage, { label: string; tone: Tone }> = {
  PAYMENT_DUE: { label: "Belum bayar", tone: "muted" },
  PAYMENT_REVIEW: { label: "Cek pembayaran", tone: "info" },
  DOCUMENTS_DUE: { label: "Belum unggah dokumen", tone: "muted" },
  DOCUMENTS_REVIEW: { label: "Cek dokumen", tone: "info" },
  SCREENING: { label: "Seleksi berkas", tone: "info" },
  INTERVIEW_PENDING: { label: "Jadwalkan wawancara", tone: "info" },
  INTERVIEW_SCHEDULED: { label: "Wawancara terjadwal", tone: "info" },
  INTERVIEWED: { label: "Putuskan hasil", tone: "info" },
  DECIDED: { label: "Menunggu pengumuman", tone: "info" },
  REREGISTRATION: { label: "Daftar ulang", tone: "success" },
  REREGISTRATION_REVIEW: { label: "Cek daftar ulang", tone: "info" },
  ENROLLED: { label: "Jadi siswa", tone: "success" },
  NOT_ADVANCED: { label: "Tidak lanjut", tone: "muted" },
  NOT_ACCEPTED: { label: "Tidak diterima", tone: "muted" },
  WITHDRAWN: { label: "Dibatalkan", tone: "muted" },
};

/** The stage as quiet text with a dot: the child leads, the step is one property. */
export function Stage({
  stage,
  needsCommittee,
}: {
  stage: ApplicationStage;
  needsCommittee: boolean;
}) {
  const tone = needsCommittee ? "warning" : STAGES[stage].tone;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "warning" && "bg-warning",
          tone === "info" && "bg-info",
          tone === "success" && "bg-success",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      {STAGES[stage].label}
    </span>
  );
}

type EntryTone = "plain" | "note" | "success";

/** One table for every event, so a new command is a type error until it has words. */
const COMMANDS: Record<ApplicationCommand, { label: string; icon: LucideIcon; tone?: EntryTone }> =
  {
    SUBMIT: { label: "Mendaftar", icon: UserRoundIcon },
    UPLOAD_PAYMENT_PROOF: { label: "Mengunggah bukti transfer", icon: BanknoteIcon },
    APPROVE_PAYMENT: { label: "Pembayaran disetujui", icon: CheckIcon, tone: "success" },
    REJECT_PAYMENT: { label: "Bukti transfer ditolak", icon: BanknoteIcon },
    SUBMIT_DOCUMENTS: { label: "Mengirim dokumen", icon: FileTextIcon },
    REQUEST_DOCUMENT_FIX: { label: "Minta perbaikan dokumen", icon: FileTextIcon },
    VERIFY_DOCUMENTS: { label: "Dokumen lengkap", icon: CheckIcon, tone: "success" },
    ADVANCE_TO_INTERVIEW: { label: "Lanjut ke wawancara", icon: ArrowRightIcon },
    STOP_AT_SCREENING: { label: "Tidak lanjut ke wawancara", icon: XIcon },
    SCHEDULE_INTERVIEW: { label: "Wawancara dijadwalkan", icon: CalendarClockIcon },
    RESCHEDULE_INTERVIEW: { label: "Jadwal wawancara diubah", icon: CalendarClockIcon },
    RECORD_ATTENDED: { label: "Wawancara selesai", icon: CheckIcon, tone: "success" },
    RECORD_NO_SHOW: { label: "Tidak hadir wawancara", icon: CalendarXIcon },
    DECIDE: { label: "Hasil diputuskan", icon: ScaleIcon },
    PUBLISH_ACCEPTED: { label: "Hasil diumumkan: diterima", icon: MegaphoneIcon, tone: "success" },
    PUBLISH_NOT_ACCEPTED: { label: "Hasil diumumkan: tidak diterima", icon: MegaphoneIcon },
    SUBMIT_REREGISTRATION: { label: "Mengirim daftar ulang", icon: FileTextIcon },
    REQUEST_REREGISTRATION_FIX: { label: "Minta perbaikan daftar ulang", icon: FileTextIcon },
    CONFIRM_ENROLLMENT: { label: "Resmi jadi siswa", icon: GraduationCapIcon, tone: "success" },
    WITHDRAW: { label: "Membatalkan pendaftaran", icon: UndoIcon },
    ADD_NOTE: { label: "Catatan internal", icon: LockIcon, tone: "note" },
    CHANGE_INTERVIEW_MODE: { label: "Mengganti cara wawancara", icon: RepeatIcon },
    EDIT_PROFILE: { label: "Mengubah data pendaftaran", icon: PencilIcon },
  };

export function commandLabel(command: ApplicationCommand) {
  return COMMANDS[command].label;
}

export function actorName(actor: AuditActor) {
  if (actor.type === "SYSTEM") return "Sistem";
  if (actor.type === "PUBLIC") return "Tanpa akun";
  if (actor.type === "OTHER_ACCOUNT") return "Akun lain";
  if (actor.type === "STAFF") return actor.name ?? "Staf";
  return actor.name;
}

const DECISIONS = { ACCEPTED: "Diterima", NOT_ACCEPTED: "Tidak diterima" } as const;

export type Entry = {
  key: string;
  icon: LucideIcon;
  tone: EntryTone;
  who: string | null;
  title: string;
  body: string | null;
  at: string;
  /** Beranda says whose application each line is about. */
  child?: ReactNode;
  /** Names folded into one line, listed on request. */
  more?: string[];
};

type EventLike = Pick<ActivityItem, "command" | "actor" | "at" | "text" | "decision">;

export function eventEntry(key: string, event: EventLike): Entry {
  const { label, icon, tone = "plain" } = COMMANDS[event.command];
  return {
    key,
    icon,
    tone,
    who: actorName(event.actor),
    title: label,
    body: event.text ?? (event.decision ? DECISIONS[event.decision] : null),
    at: event.at,
  };
}

export type AuditItem = Extract<HistoryItem, { kind: "AUDIT" }>;

/** A CRM-style feed: one icon per kind, notes on the warning tint. */
export function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <ol className="relative grid grid-cols-[minmax(0,1fr)] gap-5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
      {entries.map((entry) => (
        <li key={entry.key} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
          <span
            className={cn(
              "z-10 grid size-8 place-items-center rounded-md bg-background ring-1 ring-border",
              entry.tone === "note" && "bg-warning-tint text-warning ring-0",
              entry.tone === "success" && "bg-success-tint text-success ring-0",
            )}
          >
            <entry.icon aria-hidden className="size-4 shrink-0" />
          </span>
          <div className="grid gap-1 pt-1">
            <p className="text-sm wrap-anywhere">
              {entry.who && (
                <>
                  <span className="font-medium">{entry.who}</span>{" "}
                  <span className="text-muted-foreground">·</span>{" "}
                </>
              )}
              {entry.title}
              {entry.child && (
                <>
                  {" "}
                  <span className="text-muted-foreground">·</span> {entry.child}
                </>
              )}
            </p>
            {entry.body && (
              <p
                className={cn(
                  "text-sm text-pretty wrap-anywhere whitespace-pre-line",
                  entry.tone === "note"
                    ? "rounded-md bg-warning-tint px-3 py-2"
                    : "text-muted-foreground",
                )}
              >
                {entry.body}
              </p>
            )}
            {entry.more && (
              <details className="text-sm text-muted-foreground">
                <summary className="w-fit cursor-pointer hover:text-foreground">Lihat nama</summary>
                <ul className="mt-1 grid gap-0.5 wrap-anywhere">
                  {entry.more.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatStamp(entry.at)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The router marks a link current on its own, and by default a link with fewer
 * filters counts as current on every filtered page. Exact matching keeps its
 * marks inside each link's own rule.
 */
export const EXACT_MATCH = { exact: true, includeSearch: true };

/** Filter chips are links, so a filter is part of the address and survives a reload. */
export function chipClass(active: boolean) {
  return cn(
    "rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
    active && "bg-muted font-medium text-foreground",
  );
}

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  KARTU_KELUARGA: "Kartu Keluarga",
  AKTA_KELAHIRAN: "Akta kelahiran",
  KARTU_IDENTITAS_ANAK: "Kartu Identitas Anak",
  IJAZAH: "Ijazah",
};

/** A label above its control, with a hint or an error under it. The error wins. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid min-w-0 content-start gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-pretty text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}
