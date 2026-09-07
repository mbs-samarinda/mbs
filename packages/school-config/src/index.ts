/**
 * The fixed school list and the compile-time facts about each one. MBSS is one
 * organisation with a known set of schools, not a product schools sign up for,
 * so this is a constant — not a database table. Anything an administrator can
 * change (fees, dates, whether a school takes part in a cycle) lives in
 * PostgreSQL instead.
 */
export const SCHOOL_KEYS = ["smp", "smk", "sma"] as const;

export type SchoolKey = (typeof SCHOOL_KEYS)[number];

// A Record keyed by SchoolKey: adding a key without its facts, or facts for a
// key that does not exist, is a compile error.
const FACTS: Record<SchoolKey, { name: string; level: string; subdomain: string }> = {
  smp: { name: "SMP Islam Terpadu Madina", level: "SMP", subdomain: "smp" },
  smk: { name: "SMK Terpadu Madina", level: "SMK", subdomain: "smk" },
  sma: { name: "SMA Madina Citra Insani", level: "SMA", subdomain: "sma" },
};

export const SCHOOLS = SCHOOL_KEYS.map((key) => ({ key, ...FACTS[key] }));

export type School = (typeof SCHOOLS)[number];

/** Resolves a request hostname to a school, or null for an unknown host. */
export function schoolFromHostname(hostname: string): School | null {
  const label = hostname.split(".")[0]?.toLowerCase();
  return SCHOOLS.find((school) => school.subdomain === label) ?? null;
}
