/**
 * The fixed school list and the compile-time facts about each one. MBSS is one
 * organisation with a known set of schools, not a product schools sign up for,
 * so this is a constant — not a database table. Anything an administrator can
 * change (fees, dates, whether a school takes part in a cycle) lives in
 * PostgreSQL instead.
 */
export const SCHOOLS = [
  { key: "smp", name: "SMP Islam Terpadu Madina", level: "SMP", subdomain: "smp" },
  { key: "smk", name: "SMK Terpadu Madina", level: "SMK", subdomain: "smk" },
  { key: "sma", name: "SMA Madina Citra Insani", level: "SMA", subdomain: "sma" },
] as const;

export type School = (typeof SCHOOLS)[number];
export type SchoolKey = School["key"];

export const SCHOOL_KEYS = SCHOOLS.map((school) => school.key);

/**
 * Narrows a string read from the database to a school key. The schools table
 * holds the same fixed list, but its column is text, so this is where that
 * promise is checked rather than assumed.
 */
export function isSchoolKey(value: string): value is SchoolKey {
  return SCHOOLS.some((school) => school.key === value);
}

/** Resolves a request hostname to a school, or null for an unknown host. */
export function schoolFromHostname(hostname: string): School | null {
  const label = hostname.split(".")[0]?.toLowerCase();
  return SCHOOLS.find((school) => school.subdomain === label) ?? null;
}
