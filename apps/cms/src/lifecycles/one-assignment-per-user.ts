import { errors } from "@strapi/utils";

type LifecycleEvent = {
  params: {
    data?: Record<string, unknown>;
    where?: { id?: number };
  };
};

type StoredAssignment = {
  id?: number;
  adminUser?: { id?: number } | null;
};

/**
 * A relation arrives as a bare id from code and as `{ set: [{ id }] }` or
 * `{ connect: [{ id }] }` from the admin panel. All three name one user, and
 * anything else means the payload is not naming one — so the check steps aside
 * rather than guessing.
 */
const relationId = (value: unknown): number | string | undefined => {
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;

  const entry = value as { id?: unknown; set?: unknown; connect?: unknown };
  if (typeof entry.id === "number" || typeof entry.id === "string") return entry.id;

  const list = Array.isArray(entry.set) ? entry.set : entry.connect;
  return Array.isArray(list) && list.length > 0 ? relationId(list[0]) : undefined;
};

/**
 * Keeps one assignment row per admin user.
 *
 * Strapi has no unique constraint on a relation, so the check lives here, in the
 * shape `uniqueSlugPerOwner` uses. A second row for one user is rejected,
 * because which of the two counts has no honest answer.
 *
 * It deliberately does not touch `owners`. An earlier version deduped that list
 * here and silently emptied it: this is a database lifecycle, where a component
 * is not the array of `{ ownerKey }` objects the editor submitted, so a filter
 * looking for that property dropped every entry. The row saved with no owners
 * at all and the editor could then see nothing. Duplicates need no handling
 * anyway — `assignedOwners` reads the list by filtering `OWNER_KEYS`, which
 * dedupes and orders it on the way out.
 */
export function oneAssignmentPerUser(uid: string) {
  async function ensure(event: LifecycleEvent) {
    const data = event.params.data;
    if (!data) return;

    const id = event.params.where?.id;
    const current: StoredAssignment | null = id
      ? await strapi.db.query(uid).findOne({ where: { id }, populate: ["adminUser"] })
      : null;

    const userId = relationId(data.adminUser) ?? current?.adminUser?.id;
    if (userId === undefined) return;

    const clash: { id: number } | null = await strapi.db.query(uid).findOne({
      where: { adminUser: { id: userId }, ...(id ? { id: { $ne: id } } : {}) },
      select: ["id"],
    });

    if (clash) {
      throw new errors.ApplicationError(
        "Pengguna ini sudah punya baris penugasan. Ubah baris yang ada, jangan buat baris kedua.",
      );
    }
  }

  return { beforeCreate: ensure, beforeUpdate: ensure };
}
