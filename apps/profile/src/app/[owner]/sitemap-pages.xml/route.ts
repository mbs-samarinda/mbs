import { ARTICLE_TYPES } from "@/articles.ts";
import { getArticleIndex } from "@/cms/articles.ts";
import { getEntries } from "@/cms/entries.ts";
import { getAlbums } from "@/cms/gallery.ts";
import { isUmbrella, type Owner, ownerUrl, requireOwner } from "@/owners.ts";

/** A school's fixed pages. The umbrella has only its home. */
const SCHOOL_PAGES = [
  "profil",
  "program",
  "ekstrakurikuler",
  "fasilitas",
  "galeri",
  "unduhan",
  "kontak",
  "pendaftaran",
  "artikel",
  ...ARTICLE_TYPES.map((type) => `artikel/${type}`),
];

/**
 * Every page this owner's host answers, relative to its home.
 *
 * Only the owner's own articles: a collaboration it accepted lives on its
 * primary's host, which lists it there.
 */
async function pathsOf(owner: Owner): Promise<string[]> {
  const ownArticles = (await getArticleIndex(owner.key))
    .filter((article) => article.ownerKey === owner.key)
    .map((article) => `artikel/${article.type}/${article.slug}`);
  if (isUmbrella(owner)) return ["", ...ownArticles];

  const [activities, facilities, albums] = await Promise.all([
    getEntries(owner.key, "ekstrakurikuler-list"),
    getEntries(owner.key, "fasilitas-list"),
    getAlbums(owner.key),
  ]);
  return [
    "",
    ...SCHOOL_PAGES,
    ...activities.map((entry) => `ekstrakurikuler/${entry.slug}`),
    ...facilities.map((entry) => `fasilitas/${entry.slug}`),
    ...albums.map((album) => `galeri/${album.slug}`),
    ...ownArticles,
  ];
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Each host's sitemap.
 *
 * A plain route rather than Next's `sitemap.ts`: inside `[owner]` that file is
 * served but never told which owner it is for. Not named `sitemap.xml` either,
 * because Next claims any route ending in that name for its own convention and
 * then fails looking for a `sitemap.ts`. Crawlers find it through robots.txt,
 * so the name costs nothing. Request-time, because the
 * article index drops expired notices against the real clock; the reads behind
 * it come from the CMS cache.
 */
export async function GET(_: Request, { params }: { params: Promise<{ owner: string }> }) {
  const owner = await requireOwner(params);
  const base = ownerUrl(owner);
  const urls = (await pathsOf(owner))
    .map((path) => `<url><loc>${escapeXml(base + path)}</loc></url>`)
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
}
