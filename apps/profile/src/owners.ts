import { SCHOOLS } from "@mbs/school-config";

/**
 * The four owners a profile site can serve. An owner is not a school: the
 * umbrella has a site, a palette and content of its own, but no admission
 * cycle, no staff scope and no row in the schools table. `SCHOOLS` stays the
 * three-school list the admission side means by the word.
 */
const UMBRELLA = { key: "mbs", name: "Madina Boarding School", subdomain: null } as const;

export const OWNERS = [UMBRELLA, ...SCHOOLS] as const;

type Owner = (typeof OWNERS)[number];

const APEX = "mbss.sch.id";

/** Carries the resolved owner from the proxy to the root layout, which has no params. */
export const OWNER_HEADER = "x-mbss-owner";

/** The public hostname an owner is served on. */
export function ownerHost(owner: Owner): string {
  return owner.subdomain ? `${owner.subdomain}.${APEX}` : APEX;
}

/**
 * Resolves a request hostname to an owner, or null when no owner owns it. The
 * apex is the umbrella and a known school label under it is that school;
 * anything else is nobody, because showing one owner's content under another
 * owner's hostname is the one failure this must not have.
 *
 * `localhost` resolves the same way so the app is runnable: the bare host is
 * the umbrella and `smk.localhost` is that school. The suffix is matched
 * exactly, so this widens nothing in production.
 */
export function ownerFromHostname(hostname: string): Owner | null {
  const host = hostname
    .split(":")[0]
    ?.toLowerCase()
    .replace(/^www\./, "");
  if (!host) return null;

  const root = [APEX, "localhost"].find(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  if (!root) return null;
  if (host === root) return UMBRELLA;

  const label = host.slice(0, -`.${root}`.length);
  return SCHOOLS.find((school) => school.subdomain === label) ?? null;
}
