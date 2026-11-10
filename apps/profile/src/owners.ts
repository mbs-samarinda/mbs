import { SCHOOLS } from "@mbs/school-config";
import { notFound } from "next/navigation";

import { isArticleType, type Article } from "./articles.ts";

/**
 * The four owners a profile site can serve. An owner is not a school: the
 * umbrella has a home page, its own articles and a palette, but no other pages,
 * no admission cycle, no staff scope and no row in the schools table. `SCHOOLS`
 * stays the three-school list the admission side means by the word.
 */
const UMBRELLA = {
  key: "mbs",
  name: "Madina Boarding School",
  // `level` is the short label an owner's badge and filter chip wear. The
  // school switcher's tabs are schools only, so this one never names a tab.
  level: "MBS",
  subdomain: null,
} as const;

export const OWNERS = [UMBRELLA, ...SCHOOLS] as const;

export type Owner = (typeof OWNERS)[number];

/** Every key comes from this same list, so the fallback never runs; it only narrows the type. */
export const ownerByKey = (key: Owner["key"]) =>
  OWNERS.find((owner) => owner.key === key) ?? UMBRELLA;

/** The one owner with no subdomain, no admission and no pages beyond its home and articles. */
export const isUmbrella = (owner: Owner): owner is typeof UMBRELLA => owner.key === UMBRELLA.key;

/**
 * The owner a route's `[owner]` segment names. The proxy only rewrites to a
 * known owner, so the 404 here is unreachable; it exists to narrow the type,
 * and it raises rather than falling back because one owner's content under
 * another owner's hostname is the failure this boundary exists to stop.
 */
export async function requireOwner(params: Promise<{ owner: string }>): Promise<Owner> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();
  return owner;
}

/**
 * The same, for a page only a school has. The proxy sends the apex to a 404
 * before it reaches one (`ownerLacksPath`), so this too only narrows the type.
 */
export async function requireSchool(params: Promise<{ owner: string }>) {
  const owner = await requireOwner(params);
  if (isUmbrella(owner)) notFound();
  return owner;
}

// Overridable so a staging deploy on another domain resolves owners the same
// way; the default is production and nothing else needs setting.
const APEX = process.env.PROFILE_APEX ?? "mbss.sch.id";

/**
 * The paths the apex answers: its home, and the umbrella's own articles, which
 * its home lists beside the schools'. Every other page is a school's. The
 * favicon is here because the proxy rewrites it to the owner's `public/<owner>/`
 * file like any other path.
 */
const UMBRELLA_PATHS = new Set(["/", "/favicon.ico"]);

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
  if (!isUmbrella(owner)) return false;
  if (UMBRELLA_PATHS.has(pathname)) return false;
  const [, section, type, slug, ...rest] = pathname.split("/");
  const isArticle =
    section === "artikel" && isArticleType(type) && Boolean(slug) && rest.length === 0;
  return !isArticle;
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

/**
 * The owner for the page's own hostname, in the browser. `ownerFromHostname`
 * cannot run there: `PROFILE_APEX` is not inlined into a client bundle, so it
 * would see only the production apex and resolve every staging host to nobody.
 * The first label is enough, because the proxy has already checked the host.
 * `^www.` is stripped as the proxy strips it, or a `www.` visitor would get the
 * umbrella on their school's page.
 */
export function ownerFromBrowserHost(hostname: string | undefined): Owner | null {
  const label = hostname?.replace(/^www\./, "").split(".")[0];
  return OWNERS.find((candidate) => candidate.subdomain === label) ?? null;
}

/**
 * Where a card leads. Relative on the article's home site; the full address
 * everywhere else, because its page only exists on its primary's host.
 */
export const articleHref = (
  article: Pick<Article, "ownerKey" | "type" | "slug">,
  site: Owner["key"],
) =>
  `${article.ownerKey === site ? "/" : ownerUrl(ownerByKey(article.ownerKey))}artikel/${article.type}/${article.slug}`;
