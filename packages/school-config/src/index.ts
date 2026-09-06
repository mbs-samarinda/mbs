/**
 * The fixed school list and the compile-time facts about each one. MBSS is one
 * organisation with a known set of schools, not a product schools sign up for,
 * so this is a constant — not a database table. Anything an administrator can
 * change (fees, dates, whether a school takes part in a cycle) lives in
 * PostgreSQL instead.
 */
export const SCHOOLS = [
  {
    key: "sma",
    name: "SMA Madina Citra Insani Samarinda",
    level: "SMA",
    subdomain: "sma",
  },
  {
    key: "smp",
    name: "SMP IT Madina Samarinda",
    level: "SMP",
    subdomain: "smp",
  },
  {
    key: "sd",
    name: "SD IT Madina Samarinda",
    level: "SD",
    subdomain: "sd",
  },
] as const;

export type School = (typeof SCHOOLS)[number];
export type SchoolKey = School["key"];

export const SCHOOL_KEYS = SCHOOLS.map((school) => school.key);

/** Resolves a request hostname to a school, or null for an unknown host. */
export function schoolFromHostname(hostname: string): School | null {
  const label = hostname.split(".")[0]?.toLowerCase();
  return SCHOOLS.find((school) => school.subdomain === label) ?? null;
}
