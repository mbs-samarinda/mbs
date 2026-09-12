/**
 * The fixed school list and the compile-time facts about each one. MBSS is one
 * organisation with a known set of schools, not a product schools sign up for,
 * so this is a constant — not a database table. Anything an administrator can
 * change (fees, dates, whether a school takes part in a cycle) lives in
 * PostgreSQL instead.
 *
 * The palettes are here for the same reason. Approving one means approving how
 * five values hold their contrast against each other, which takes the school's
 * and the brand owner's sign-off, so they are not content an editor sets in the
 * CMS the way a tagline is. Approved 12 September 2026; see the brand guide.
 * Each primary carries white text at normal size and no accent does, which is
 * what keeps an accent from becoming a button surface.
 */
export const SCHOOLS = [
  {
    key: "smp",
    name: "SMP Islam Terpadu Madina",
    level: "SMP",
    subdomain: "smp",
    palette: {
      primary: "#1A6B3F",
      primaryHover: "#14532D",
      accent: "#C9A227",
      surface: "#E8F2EC",
      ring: "#0B3A22",
    },
  },
  {
    key: "smk",
    name: "SMK Terpadu Madina",
    level: "SMK",
    subdomain: "smk",
    palette: {
      primary: "#1D63C4",
      primaryHover: "#17509F",
      accent: "#F26A21",
      surface: "#E8F0FB",
      ring: "#0E3268",
    },
  },
  {
    key: "sma",
    name: "SMA Madina Citra Insani",
    level: "SMA",
    subdomain: "sma",
    palette: {
      primary: "#B01C2E",
      primaryHover: "#8E1524",
      accent: "#E8B62C",
      surface: "#FBECEE",
      ring: "#650F1A",
    },
  },
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
