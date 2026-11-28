import { serverNow } from "@mbs/api-client/http";
import { formatDayAndMonth, formatTime, TIME_ZONE } from "@mbs/school-config/format";

const counter = new Intl.NumberFormat("id-ID");
export const formatCount = (value: number) => counter.format(value);

/** First letter of the first and last word, in any script. A leading mark such as an apostrophe is skipped. */
export function initials(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}]+/u, ""))
    .filter(Boolean);
  const first = Array.from(words[0] ?? "?")[0] ?? "?";
  const last = words.length > 1 ? (Array.from(words.at(-1)!)[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function firstName(name: string) {
  return name.split(/\s+/).find(Boolean) ?? name;
}

const calendarDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

/** Whole calendar days between two instants, counted on Samarinda's calendar. */
function daysBefore(iso: string, now: Date) {
  const day = (date: Date) => Date.parse(calendarDay.format(date));
  return Math.round((day(now) - day(new Date(iso))) / 86_400_000);
}

const year = (date: Date) => Number(calendarDay.format(date).slice(0, 4));

function dayLabel(iso: string, now: Date) {
  const days = daysBefore(iso, now);
  if (days === 0) return "Hari ini";
  if (days === 1) return "Kemarin";
  const date = new Date(iso);
  return year(date) === year(now)
    ? formatDayAndMonth(iso)
    : `${formatDayAndMonth(iso)} ${year(date)}`;
}

/** For a feed: "Hari ini, 10.10 WITA". */
export function formatStamp(iso: string, now = serverNow()) {
  return `${dayLabel(iso, now)}, ${formatTime(iso)}`;
}

/** For a list cell: "2 jam lalu", "kemarin", "3 hari lalu". */
export function formatAgo(iso: string, now = serverNow()) {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  // Minutes win over the calendar, so 23.58 seen at 00.03 is "5 menit lalu", not "kemarin".
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const days = daysBefore(iso, now);
  if (days === 0) return `${Math.floor(minutes / 60)} jam lalu`;
  if (days === 1) return "kemarin";
  if (days < 7) return `${days} hari lalu`;
  return dayLabel(iso, now);
}

/** How long something has waited, rounded down: "4 hari", "3 jam". */
export function formatWaited(since: string, now = serverNow()) {
  const minutes = Math.max(1, Math.floor((now.getTime() - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam` : `${Math.floor(hours / 24)} hari`;
}

const oneDecimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${oneDecimal.format(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const rupiah = new Intl.NumberFormat("id-ID");
/** "Rp250.000", the way the school writes it. */
export const formatRupiah = (value: number) => `Rp${rupiah.format(value)}`;

const shortDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const clock = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "1 Des 2026, 08.00", for a line that names several times and says WITA once. */
export const formatShortDateTime = (iso: string) =>
  `${shortDate.format(new Date(iso))}, ${clock.format(new Date(iso))}`;

/** The calendar day and clock time in Samarinda, as a form edits them: "2026-12-01" and "08.00". */
export function toWita(iso: string) {
  const date = new Date(iso);
  return { day: calendarDay.format(date), time: clock.format(date) };
}

// Samarinda keeps UTC+8 all year, so a fixed offset is exact.
const WITA_OFFSET = "+08:00";

/** The instant for a Samarinda day and time. Null when the time is not a real "HH.MM". */
export function fromWita(day: string, time: string) {
  const match = /^([01]?\d|2[0-3])[.:]([0-5]\d)$/.exec(time.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !match) return null;
  const [, hours, minutes] = match;
  return new Date(`${day}T${hours!.padStart(2, "0")}:${minutes}:00${WITA_OFFSET}`).toISOString();
}
