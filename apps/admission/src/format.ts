import { SCHOOLS, type SchoolKey } from "@mbs/school-config";

const rupiah = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const list = new Intl.ListFormat("id-ID", { type: "conjunction" });

export const formatFee = (amount: number) => `Rp${rupiah.format(amount)}`;
export const formatList = (items: string[]) => list.format(items);

const oneDecimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** How big a file is, in the unit a person would say out loud. */
export function formatBytes(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${oneDecimal.format(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Rounded up, so trying again after it always works. */
export function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} menit` : `${Math.ceil(minutes / 60)} jam`;
}

export function schoolName(key: SchoolKey) {
  return SCHOOLS.find((school) => school.key === key)!.name;
}

export const MONTHS = Array.from({ length: 12 }, (_, month) => ({
  value: String(month + 1).padStart(2, "0"),
  name: new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", month: "long" }).format(
    Date.UTC(2000, month),
  ),
}));
