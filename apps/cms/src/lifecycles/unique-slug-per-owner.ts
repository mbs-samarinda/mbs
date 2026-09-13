import { errors } from "@strapi/utils";

type LifecycleEvent = {
  params: {
    data?: Record<string, unknown>;
    where?: { id?: number };
  };
};

/** The columns this check reads back from the row being updated. */
type StoredEntry = {
  documentId?: string;
  ownerKey?: string;
  slug?: string;
  title?: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Lifecycle data is `Record<string, unknown>`, so every field arrives unknown.
// This narrows without asserting, and treats an empty string as absent — which
// is what the admin panel sends for a field the editor left alone.
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Keeps an address unique inside its owner, and only inside its owner.
 *
 * Strapi's `uid` type was the obvious fit and is the wrong one here: it checks
 * uniqueness across the whole collection with no notion of a tenant, so the
 * first school to publish "Penerimaan Siswa Baru" would take that address from
 * the other two — on sites that share no hostname, no listing and no reader. So
 * slug is a plain string, generated from the title when an editor leaves it
 * empty, and checked here against the owner's own entries.
 *
 * `siblings` covers the case where two collections share one address space:
 * Berita and Pengumuman are separate types rendered in one `/berita` listing,
 * so an address taken in either is taken in both.
 *
 * Draft-and-publish gives one document two rows, so the check excludes the
 * document being saved rather than the row.
 */
export function uniqueSlugPerOwner(uid: string, siblings: readonly string[] = []) {
  async function ensure(event: LifecycleEvent) {
    const data = event.params.data;
    if (!data) return;

    const id = event.params.where?.id;
    const current: StoredEntry | null = id
      ? await strapi.db
          .query(uid)
          .findOne({ where: { id }, select: ["documentId", "ownerKey", "slug", "title"] })
      : null;

    const ownerKey = text(data.ownerKey) ?? current?.ownerKey;
    const title = text(data.title) ?? current?.title;
    const slug = text(data.slug) ?? current?.slug ?? (title ? slugify(title) : undefined);
    if (!ownerKey || !slug) return;

    data.slug = slug;

    const documentId = text(data.documentId) ?? current?.documentId;

    for (const collection of [uid, ...siblings]) {
      const clash: { id: number } | null = await strapi.db.query(collection).findOne({
        where: { ownerKey, slug, ...(documentId ? { documentId: { $ne: documentId } } : {}) },
        select: ["id"],
      });

      if (clash) {
        throw new errors.ApplicationError(
          `Alamat "${slug}" sudah dipakai pada ${ownerKey}. Ubah judul atau alamatnya.`,
        );
      }
    }
  }

  return { beforeCreate: ensure, beforeUpdate: ensure };
}
