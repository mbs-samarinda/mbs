import type { Core, UID } from "@strapi/strapi";
import { errors } from "@strapi/utils";

import { OWNER_KEYS, type OwnerKey } from "./seed/home-page";

/**
 * Two checks, not one role per owner.
 *
 * The role says what an editor may do; the assignment row says whose content
 * they may do it to. A condition handler is awaited once per request when the
 * ability is built, so it can read that row from the database — which is why no
 * role here is ever named after a school.
 */
export const EDITOR_ROLE_CODE = "mbs-editor-konten";

/** A condition registered with no plugin gets an `api::` id. */
export const OWNER_SCOPE_CONDITION = "api::owner-scope";

const ASSIGNMENT_UID = "api::penugasan-editor.penugasan-editor";
const SUPER_ADMIN_CODE = "strapi-super-admin";
const CREATE = "plugin::content-manager.explorer.create";
const DELETE = "plugin::content-manager.explorer.delete";

// Editors compose inside these two; they never add or remove one. `slug` is an
// enumeration and a `Page` row exists per route, so a new page is a code change,
// deleting one takes a live route down, and deleting a `Site` row breaks every
// page of that owner's profile, which throws when it is missing.
const NO_CREATE_OR_DELETE = new Set<string>(["api::page.page", "api::site.site"]);

// Media cannot be scoped: the upload plugin registers its actions with no
// subject, and a condition filters a query by subject. So these are granted
// flat, exactly as Strapi's own Editor role has them, and every editor can see
// and delete every school's photographs. That is a boundary between colleagues
// rather than one facing the public, and it is accepted rather than deferred.
// There is no `assets.delete` to withhold — deletion rides on `assets.update`.
const MEDIA_ACTIONS = [
  "plugin::upload.read",
  "plugin::upload.configure-view",
  "plugin::upload.assets.create",
  "plugin::upload.assets.update",
  "plugin::upload.assets.download",
  "plugin::upload.assets.copy-link",
];

type AdminActor = { id?: unknown; roles?: { code?: string }[] };
type OwnerFilter = { ownerKey: { $in: OwnerKey[] } };
type Action = { section: string; actionId: string };
type SeedPermission = { action: string; subject?: string | null; conditions: string[] };

type PermissionService = {
  actionProvider: { values(): Action[] };
  conditionProvider: {
    register(condition: {
      name: string;
      displayName: string;
      handler: (user: AdminActor) => Promise<OwnerFilter | false>;
    }): Promise<unknown>;
  };
};

type ContentTypeService = {
  getPermissionsWithNestedFields(actions: Action[]): { action: string; subject: string }[];
};

type RoleService = {
  findOne(params: { code: string }): Promise<{ id: number } | null>;
  create(attributes: { name: string; code: string; description: string }): Promise<{ id: number }>;
  assignPermissions(roleId: number, permissions: SeedPermission[]): Promise<unknown>;
};

// `strapi.service` is typed against this application's own content-type UIDs.
// All three services read here belong to the admin package, which that union
// does not cover, so the assertion is unavoidable. Each one names the shape it
// needs — declared above — rather than widening to `any`.
/* oxlint-disable typescript/no-unsafe-type-assertion -- admin services sit outside the generated UID union */
const permissionService = (strapi: Core.Strapi) =>
  strapi.service("admin::permission") as unknown as PermissionService;

const contentTypeService = (strapi: Core.Strapi) =>
  strapi.service("admin::content-type") as unknown as ContentTypeService;

const roleService = (strapi: Core.Strapi) =>
  strapi.service("admin::role") as unknown as RoleService;
/* oxlint-enable typescript/no-unsafe-type-assertion */

/** Every content type that carries an owner, read off the schemas rather than listed. */
const scopedUids = (strapi: Core.Strapi): string[] =>
  Object.values(strapi.contentTypes)
    .filter(
      (contentType) => contentType.uid.startsWith("api::") && "ownerKey" in contentType.attributes,
    )
    .map((contentType) => contentType.uid);

/**
 * The owners one admin user may write, in the fixed order of `OWNER_KEYS`.
 *
 * Filtering the known keys rather than mapping the row does three jobs at once:
 * it drops anything that is not an owner key, it dedupes, and it gives the same
 * list in the same order for the same assignment — which keeps the generated
 * condition stable and comparable.
 */
async function assignedOwners(strapi: Core.Strapi, userId: unknown): Promise<OwnerKey[]> {
  if (typeof userId !== "number" && typeof userId !== "string") return [];

  const row: { owners?: ({ ownerKey?: string } | null)[] } | null = await strapi.db
    .query(ASSIGNMENT_UID)
    .findOne({ where: { adminUser: { id: userId } }, populate: ["owners"] });

  const assigned = (row?.owners ?? []).map((entry) => entry?.ownerKey);
  return OWNER_KEYS.filter((key) => assigned.includes(key));
}

const isSuperAdmin = (actor: AdminActor) =>
  (actor.roles ?? []).some((role) => role?.code === SUPER_ADMIN_CODE);

// Koa types `ctx.state.user` as `any`. Narrowing through a guard keeps that
// `any` from spreading: everything downstream is `AdminActor` or nothing.
const isActor = (value: unknown): value is AdminActor =>
  typeof value === "object" && value !== null;

/**
 * Registers the condition that narrows every read to the editor's own owners.
 *
 * The return value is a contract, not a preference: a filter with a **non-empty**
 * list, or `false`. Never `true` and never `{}` — the permission engine treats
 * both as "nothing to filter by" and registers the permission with no condition
 * at all, which is unrestricted access to all four owners and the exact failure
 * this slice exists to prevent. `undefined` happens to deny, incidentally, and
 * is not leant on.
 *
 * It has to be registered before the role is seeded: `addPermissions` sanitizes
 * away any condition the provider does not know, so a late registration seeds
 * the permission unconditioned — the same hole reached from the other side.
 */
export async function registerOwnerScope(strapi: Core.Strapi) {
  await permissionService(strapi).conditionProvider.register({
    name: "owner-scope",
    displayName: "Hanya pemilik yang ditugaskan",
    handler: async (user) => {
      const owners = await assignedOwners(strapi, user?.id);
      return owners.length > 0 ? { ownerKey: { $in: owners } } : false;
    },
  });
}

/**
 * One role for every editor, created if it is missing and never re-asserted.
 *
 * Same rule as `seedSites`, for a sharper reason: `assignPermissions` diffs the
 * list it is given against what the role holds and deletes the difference, so
 * re-seeding on every boot would silently revert an administrator's panel edit.
 *
 * A global content administrator is this same role assigned all four owners.
 * Super Admin stays the developer account.
 */
export async function seedEditorRole(strapi: Core.Strapi) {
  const roles = roleService(strapi);
  const existing = await roles.findOne({ code: EDITOR_ROLE_CODE });
  if (existing) return;

  const role = await roles.create({
    name: "Editor Konten",
    code: EDITOR_ROLE_CODE,
    description:
      "Mengelola konten pemilik yang ditugaskan pada barisnya di Penugasan Editor. Tidak bisa menambah atau menghapus Halaman dan Situs.",
  });

  const scoped = new Set(scopedUids(strapi));
  const actions = permissionService(strapi)
    .actionProvider.values()
    .filter((action) => action.section === "contentTypes");

  const permissions: SeedPermission[] = contentTypeService(strapi)
    .getPermissionsWithNestedFields(actions)
    .filter(({ subject }) => scoped.has(subject))
    .filter(
      ({ action, subject }) =>
        !(NO_CREATE_OR_DELETE.has(subject) && (action === CREATE || action === DELETE)),
    )
    // The field list that call just computed is dropped on purpose. A rule whose
    // `fields` is nil means every field, so the page slices still to come can
    // add block fields without anybody re-ticking checkboxes. Opening the role
    // in the admin panel and saving it writes an explicit list and ends that.
    //
    // Exactly one condition per permission: results are combined as
    // `{ $and: [{ $or: results }] }`, so a second condition returning `true`
    // would discard the owner filter.
    .map(({ action, subject }) => ({ action, subject, conditions: [OWNER_SCOPE_CONDITION] }));

  permissions.push(...MEDIA_ACTIONS.map((action) => ({ action, conditions: [] })));

  await roles.assignPermissions(role.id, permissions);
}

/** Has any row of this document ever carried a publication date? */
async function everPublished(strapi: Core.Strapi, uid: UID.ContentType, documentId: string) {
  // No draft buffer means no unpublished state: every row is live, so the owner
  // is immutable outright. `Site` is the only one, and editors hold no create or
  // delete on it anyway.
  if (!strapi.contentType(uid).options?.draftAndPublish) return true;

  // Not `publishedAt IS NULL` on the incoming row: draft-and-publish gives one
  // document two rows and the draft's `publishedAt` is always null, so that test
  // would wave through a published article. The question is about the document.
  const published: { id: number } | null = await strapi.db
    .query(uid)
    .findOne({ where: { documentId, publishedAt: { $notNull: true } }, select: ["id"] });

  return published !== null;
}

/**
 * The half of the boundary a condition cannot reach.
 *
 * `permissionChecker.cannot.create()` is called with no argument, so CASL has no
 * instance to test and the create condition is inert — Strapi's own source
 * carries the unfixed `// TODO: Revert the creation if create permission
 * conditions are not met`. Without this guard an SMP editor can create a row
 * with `ownerKey: "mbs"`.
 *
 * Two rules, in this order:
 *
 * - a change of `ownerKey` on a document that has ever been published is
 *   refused for **everyone**, Super Admin included. A draft that was never
 *   published may still be moved, which is where nearly every misfile is
 *   caught, so the common case costs one field edit rather than a delete and a
 *   retype. Once it is published the repair is delete and recreate, and that
 *   costs a new `documentId`: every relation holding the old one drops it
 *   silently, and `publishedAt` is restamped with today;
 * - whoever is writing the field has to land on an owner they are assigned.
 *   Super Admin is exempt here, and only here: this is middleware rather than a
 *   condition, so Strapi's own Super Admin bypass never reaches it, and without
 *   the exemption the developer account could not create content at all.
 */
export async function assertOwnerScope(
  strapi: Core.Strapi,
  context: { uid: UID.ContentType; action: string; params: unknown },
) {
  if (context.action !== "create" && context.action !== "update") return;
  if (!("ownerKey" in strapi.contentType(context.uid).attributes)) return;

  // The document service types `params` per action and per content type, so the
  // union it hands a middleware has no single shape to read. Only two fields are
  // touched, and both are checked before use.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing one middleware payload to the two fields read below
  const params = context.params as { data?: { ownerKey?: unknown }; documentId?: string };
  const next = params?.data?.ownerKey;
  // An update that does not carry the field is not a move. Seeds update pages at
  // boot without ever mentioning an owner.
  if (typeof next !== "string") return;

  // `requestContext` is AsyncLocalStorage and answers `undefined` outside a
  // request, which is where every seed runs. Public REST is read-only, so there
  // is no third write path to cover.
  const state: unknown = strapi.requestContext.get()?.state?.user;
  if (!isActor(state)) return;
  const actor = state;

  if (context.action === "update") {
    const documentId = params?.documentId;
    const current: { ownerKey?: string } | null = documentId
      ? await strapi.db.query(context.uid).findOne({ where: { documentId }, select: ["ownerKey"] })
      : null;

    if (!current || current.ownerKey === next) return;

    if (documentId && (await everPublished(strapi, context.uid, documentId))) {
      throw new errors.ApplicationError(
        "Pemilik tidak bisa diubah setelah entri pernah terbit. Hapus entri ini lalu buat ulang pada pemilik yang benar.",
      );
    }
  }

  if (isSuperAdmin(actor)) return;

  const owners = await assignedOwners(strapi, actor.id);
  if (!owners.some((owner) => owner === next)) {
    throw new errors.ForbiddenError(
      `Anda tidak ditugaskan pada pemilik "${next}". Minta administrator menambahkannya di Penugasan Editor.`,
    );
  }
}
