import type { Core, UID } from "@strapi/strapi";
import { errors } from "@strapi/utils";

import { OWNER_KEYS } from "./seed/home-page";

export const KOLABORASI_UID = "api::kolaborasi.kolaborasi";

/** The two article types that take collaborators, and the Kolaborasi field that points at each. */
const ARTICLES = {
  "api::berita.berita": "berita",
  "api::pengumuman.pengumuman": "pengumuman",
} as const;

type ArticleUid = keyof typeof ARTICLES;

const isArticle = (uid: string): uid is ArticleUid => uid in ARTICLES;

// The CMS has no list of the profile's hosts — `PUBLIC_URL` is its own address —
// so the rule is copied from the profile's `ownerHost`, apex included. Staging
// sets `PROFILE_APEX`; left unset, the copy names production, which is what an
// invitee reading it needs to recognise.
const APEX = process.env.PROFILE_APEX ?? "mbss.sch.id";

const articleUrl = (ownerKey: string, slug: string) =>
  `https://${ownerKey === "mbs" ? APEX : `${ownerKey}.${APEX}`}/berita/${slug}`;

/**
 * The schools an article may invite: never the umbrella, never its own owner,
 * each once. Filtering `OWNER_KEYS` rather than mapping the list dedupes and
 * orders in one step, as `assignedOwners` does.
 */
const invitable = (ticked: unknown[], primary: unknown) =>
  OWNER_KEYS.filter((key) => key !== "mbs" && key !== primary && ticked.includes(key));

const ownerKeyOf = (entry: unknown) =>
  typeof entry === "object" && entry !== null && "ownerKey" in entry ? entry.ownerKey : undefined;

type Params = {
  data?: { ownerKey?: unknown; collaborators?: unknown };
  documentId?: string;
  status?: string;
};

type Row = { id: number; ownerKey: string };

type PublishedArticle = {
  id: number;
  ownerKey: string;
  title: string;
  slug: string | null;
  collaborators?: ({ ownerKey?: string } | null)[];
};

/**
 * Refuses a tick list the article could never honour, on save rather than on
 * publish, so the editor sees it while the list is still in front of them.
 *
 * Only when the list is in the payload: the admin panel always sends the whole
 * form, and code that writes an article without mentioning the list is not
 * changing it.
 */
async function assertCollaborators(strapi: Core.Strapi, uid: ArticleUid, params: Params) {
  const list = params.data?.collaborators;
  if (!Array.isArray(list)) return;

  const ticked = list.map(ownerKeyOf);
  let primary = params.data?.ownerKey;
  if (typeof primary !== "string" && params.documentId) {
    const current: { ownerKey?: string } | null = await strapi.db
      .query(uid)
      .findOne({ where: { documentId: params.documentId }, select: ["ownerKey"] });
    primary = current?.ownerKey;
  }

  if (ticked.includes("mbs")) {
    throw new errors.ApplicationError("MBS tidak bisa diundang sebagai kolaborator.");
  }
  if (primary !== undefined && ticked.includes(primary)) {
    throw new errors.ApplicationError("Pemilik artikel tidak bisa menjadi kolaboratornya sendiri.");
  }
  if (new Set(ticked).size !== ticked.length) {
    throw new errors.ApplicationError("Satu sekolah hanya bisa diundang sekali.");
  }
}

/** Every Kolaborasi row of one article, whichever of its two rows it points at. */
const rowsOf = (strapi: Core.Strapi, uid: ArticleUid, documentId: string): Promise<Row[]> =>
  strapi.db
    .query(KOLABORASI_UID)
    .findMany({ where: { [ARTICLES[uid]]: { documentId } }, select: ["id", "ownerKey"] });

/**
 * Makes the rows match the ticks on the article just published.
 *
 * Every kept row is re-asked and re-pointed. Publishing replaces the published
 * row with a new id, and pointing each row at it here is what guarantees the
 * public side — which only ever reads published rows — still finds them,
 * whatever Strapi's own relation sync does.
 */
async function reconcile(strapi: Core.Strapi, uid: ArticleUid, documentId: string, rows: Row[]) {
  const article: PublishedArticle | null = await strapi.db.query(uid).findOne({
    where: { documentId, publishedAt: { $notNull: true } },
    populate: ["collaborators"],
  });
  if (!article) return;

  const ticked = invitable((article.collaborators ?? []).map(ownerKeyOf), article.ownerKey);
  const copies = {
    status: "menunggu",
    judul: article.title,
    alamat: articleUrl(article.ownerKey, article.slug ?? ""),
    [ARTICLES[uid]]: article.id,
  };

  // Unticked schools go, and so does any second row for one school, which only
  // two publishes racing could leave behind.
  const dropped = rows.filter(
    (row, index) =>
      !ticked.some((key) => key === row.ownerKey) ||
      rows.findIndex((other) => other.ownerKey === row.ownerKey) !== index,
  );
  if (dropped.length > 0) {
    await strapi.db
      .query(KOLABORASI_UID)
      .deleteMany({ where: { id: { $in: dropped.map((row) => row.id) } } });
  }

  for (const ownerKey of ticked) {
    const row = rows.find((candidate) => candidate.ownerKey === ownerKey);
    await (row
      ? strapi.db.query(KOLABORASI_UID).update({ where: { id: row.id }, data: copies })
      : // `publishedAt` because the document service stamps it on every row of a
        // type without draft-and-publish, and reads of such a type expect it.
        strapi.db
          .query(KOLABORASI_UID)
          .create({ data: { ...copies, ownerKey, publishedAt: new Date() } }));
  }
}

const documentIdOf = (result: unknown) =>
  typeof result === "object" &&
  result !== null &&
  "documentId" in result &&
  typeof result.documentId === "string"
    ? result.documentId
    : undefined;

/**
 * Keeps an article's Kolaborasi rows in step with it. Called before the write
 * with the document middleware's context; the function it returns runs after
 * the write with its result. Split in two because the rows have to be read
 * before an unpublish or delete, which takes the published row — the one they
 * point at — with it.
 *
 * Rows are written with `strapi.db.query`, never the document service: they
 * belong to other schools, and `assertOwnerScope` would rightly refuse an SMA
 * editor writing an SMK row. That also means these writes skip the middleware
 * and its profile notification, which is fine — they only happen inside a
 * publish, unpublish or delete that already notifies.
 *
 * A plain draft save only validates. Rows change on publish, so an editor can
 * untick a school and change their mind before anyone sees it.
 *
 * A collaborator deleting its own row leaves the tick alone, so the next
 * publish invites it again. That is intended: every publish re-asks.
 */
export async function trackCollaborations(
  strapi: Core.Strapi,
  context: { uid: UID.ContentType; action: string; params: unknown },
): Promise<(result: unknown) => Promise<void>> {
  const { uid, action } = context;
  if (!isArticle(uid)) return async () => {};

  // Same narrowing as `assertOwnerScope`: the union of per-action params has no
  // single shape, and every field read below is checked before use.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing one middleware payload to the fields read below
  const params = (context.params ?? {}) as Params;
  const saves = action === "create" || action === "update";
  if (saves) await assertCollaborators(strapi, uid, params);

  const publishes = action === "publish" || (saves && params.status === "published");
  const removes = action === "unpublish" || action === "delete";
  const rows =
    params.documentId && (publishes || removes) ? await rowsOf(strapi, uid, params.documentId) : [];

  return async (result) => {
    if (removes && params.documentId) {
      if (rows.length > 0) {
        await strapi.db
          .query(KOLABORASI_UID)
          .deleteMany({ where: { id: { $in: rows.map((row) => row.id) } } });
      }
      // Only the draft is left after an unpublish, and nothing after a delete.
      // The document service, because a component cannot be written through
      // `db.query`; this comes back through the middleware as a plain update.
      if (action === "unpublish") {
        await strapi
          .documents(uid)
          .update({ documentId: params.documentId, data: { collaborators: [] } });
      }
    }

    const documentId = params.documentId ?? documentIdOf(result);
    if (publishes && documentId) await reconcile(strapi, uid, documentId, rows);
  };
}
