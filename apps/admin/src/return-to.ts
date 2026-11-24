import { isSchoolKey, type SchoolKey } from "@mbs/school-config";

/** Indonesian keys, like `/masuk?lanjut=`. Every key is always set, so nothing unchecked slips through. */
export type ListSearch = {
  sekolah?: SchoolKey | undefined;
  tampil?: "perlu" | undefined;
  cari?: string | undefined;
  halaman?: number | undefined;
};

export const SEARCH_MAX = 100;

/** The list's URL, and anything remembered from it, pass through here. */
export function parseListSearch(search: { [K in keyof ListSearch]?: unknown }): ListSearch {
  // The router reads `?cari=2025` as a number.
  const cari = ["string", "number"].includes(typeof search.cari)
    ? String(search.cari).trim().slice(0, SEARCH_MAX)
    : "";
  const halaman = Number(search.halaman);
  return {
    sekolah:
      typeof search.sekolah === "string" && isSchoolKey(search.sekolah)
        ? search.sekolah
        : undefined,
    tampil: search.tampil === "perlu" ? "perlu" : undefined,
    cari: cari || undefined,
    halaman: Number.isInteger(halaman) && halaman > 1 ? halaman : undefined,
  };
}

/**
 * The list a visitor left and the row they opened, so "← Pendaftar" returns to
 * the same filters and page, and focus lands on the same row.
 */
const KEY = "pendaftar:dibuka";

type ReturnTo = { id: string; search: ListSearch };

export function rememberRow(value: ReturnTo) {
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

/** Reads without clearing: the child page builds its back link from it. */
export function peekReturnTo(): ReturnTo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("id" in parsed) || typeof parsed.id !== "string") return null;
  if (!("search" in parsed) || typeof parsed.search !== "object" || parsed.search === null) {
    return null;
  }
  return { id: parsed.id, search: parseListSearch(parsed.search) };
}

/** Reads once: only the first list render after coming back moves focus. */
export function takeReturnTo() {
  const value = peekReturnTo();
  sessionStorage.removeItem(KEY);
  return value;
}
