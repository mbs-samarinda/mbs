import { SCHOOLS, type SchoolKey } from "@mbs/school-config";

// The schools are in Samarinda, so every date and time is theirs, wherever the
// phone is.
const timeZone = "Asia/Makassar";
const dayAndMonth = new Intl.DateTimeFormat("id-ID", { timeZone, day: "numeric", month: "long" });
const date = new Intl.DateTimeFormat("id-ID", {
  timeZone,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const time = new Intl.DateTimeFormat("id-ID", {
  timeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const rupiah = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const list = new Intl.ListFormat("id-ID", { type: "conjunction" });

export const formatDayAndMonth = (iso: string) => dayAndMonth.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatTime = (iso: string) => `${time.format(new Date(iso))} WITA`;
export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;
export const formatFee = (amount: number) => `Rp${rupiah.format(amount)}`;
export const formatList = (items: string[]) => list.format(items);

export function schoolName(key: SchoolKey) {
  return SCHOOLS.find((school) => school.key === key)!.name;
}

export const MONTHS = Array.from({ length: 12 }, (_, month) => ({
  value: String(month + 1).padStart(2, "0"),
  name: new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", month: "long" }).format(
    Date.UTC(2000, month),
  ),
}));
