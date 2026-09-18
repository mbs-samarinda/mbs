import { SCHOOLS } from "@mbs/school-config";

/**
 * The four owners a profile site can serve. An owner is not a school: the
 * umbrella has a site, a palette and content of its own, but no admission
 * cycle, no staff scope and no row in the schools table. `SCHOOLS` stays the
 * three-school list the admission side means by the word.
 */
const UMBRELLA = {
  key: "mbs",
  name: "Madina Boarding School",
  // `level` is the school switcher's tab label. The umbrella has no jenjang, so
  // it wears its own key — which is what the tabs read on the canvas.
  level: "MBS",
  subdomain: null,
} as const;

export const OWNERS = [UMBRELLA, ...SCHOOLS] as const;

export type Owner = (typeof OWNERS)[number];

// Overridable so a staging deploy on another domain resolves owners the same
// way; the default is production and nothing else needs setting.
const APEX = process.env.PROFILE_APEX ?? "mbss.sch.id";

/**
 * The paths only the schools own. The umbrella teaches no classes and lists no
 * activities, so it has no page at any of them: its navigation carries no entry
 * for one and the CMS seeds it no row.
 *
 * A path no route file claims already answers `global-not-found.tsx` on its
 * own; a path listed here is one a route *does* claim, which the apex has to be
 * steered away from.
 */
const SCHOOL_ONLY = ["/program", "/ekstrakurikuler", "/fasilitas"] as const;

/**
 * Whether this owner has no page at this path.
 *
 * The proxy asks before it rewrites, because a page cannot answer this itself.
 * `notFound()` inside the tree looks for a `not-found.js` boundary, and the root
 * layout lives inside `[owner]` so there is none — Next then renders its own
 * built-in 404 instead of the branded one. `global-not-found.tsx` only answers a
 * URL that matches no route at all, so the apex has to be sent to one.
 */
export function ownerLacksPath(owner: Owner, pathname: string): boolean {
  // Only the umbrella lacks these, and it is the one owner with no subdomain.
  if (owner.subdomain) return false;
  return SCHOOL_ONLY.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The public hostname an owner is served on. */
export function ownerHost(owner: Owner): string {
  return owner.subdomain ? `${owner.subdomain}.${APEX}` : APEX;
}

/**
 * The absolute URL of an owner's home page, for the one kind of link that
 * cannot be relative: the schools sit on different hosts from each other.
 *
 * Local hosts get `http` and the dev port, because `https://smk.localhost/` is
 * not reachable and a switcher that leaves the machine is worse than no
 * switcher.
 *
 * `APEX` is read once when this module loads, and nothing prerenders any more,
 * so these links come from the value the *serving* process was started with. A
 * deploy on another domain sets `PROFILE_APEX` in its environment and restarts;
 * changing it needs no rebuild, but it does need a restart, because a module
 * already loaded keeps the old value.
 */
export function ownerUrl(owner: Owner): string {
  const host = ownerHost(owner);
  // 3002 is written here rather than read from PORT: the dev and start scripts
  // pass it as a CLI flag, which Next does not put in the environment, so an
  // exported PORT meant for something else would rewrite every local link to a
  // port nothing serves.
  return host.endsWith("localhost") ? `http://${host}:3002/` : `https://${host}/`;
}

/**
 * Where an application is actually made. The profile sites only ever link here.
 *
 * Derived from the same apex rather than given an environment variable of its
 * own: two variables means a staging build that sets only `PROFILE_APEX` sends
 * parents to the production admission app, and nothing in the page would show it.
 */
export function admissionUrl(): string {
  // 5173 is the admission app's own dev port, from its vite config — written
  // here for the same reason 3002 is above: nothing puts it in the environment.
  return APEX.endsWith("localhost") ? "http://localhost:5173/" : `https://admission.${APEX}/`;
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
