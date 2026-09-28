// Node's own test runner, not vitest, and every runtime import is `require`.
//
// Strapi is a CommonJS application. Its ESM build imports `lodash/fp` as a
// directory, which real Node ESM refuses, so it only works when something
// bundles it — a bundler-based runner loads that build and dies before the
// first assertion. `require` loads the CommonJS build, which is what `strapi
// start` runs in production, so this suite boots Strapi exactly as a real
// server does.
//
// That is also why nothing here uses a top-level `import`: Node picks a
// module's kind from its syntax, and one `import` statement would flip this
// file to ESM and take Strapi's broken build with it. `import type` is erased
// before Node ever sees it, so it is safe.
//
// The assertions below reach into two places TypeScript cannot follow: a Koa
// context stood up by hand, and `admin::permission`, which lives outside the
// generated UID union. Both are confined to the two helpers.
/* oxlint-disable typescript/no-unsafe-type-assertion -- a CommonJS bridge into Strapi's untyped admin surface */
import type { Core } from "@strapi/strapi";

const { after, before, describe, it } = require("node:test") as typeof import("node:test");
const assert = require("node:assert/strict") as typeof import("node:assert/strict");

// Booting Strapi runs its migrations and every seed, so this must never point at
// a database anybody works in. Defaults are set before Strapi loads `.env` —
// dotenv leaves an existing variable alone — and then checked, so a developer's
// own `DATABASE_NAME=mbs_cms` cannot reach this suite by accident.
process.env.DATABASE_CLIENT ??= "postgres";
process.env.DATABASE_HOST ??= "localhost";
process.env.DATABASE_PORT ??= "5432";
process.env.DATABASE_NAME ??= "mbs_cms_test";
process.env.DATABASE_USERNAME ??= "mbs";
process.env.DATABASE_PASSWORD ??= "mbs_local_dev";

if (!process.env.DATABASE_NAME.endsWith("_test")) {
  throw new Error(
    `Refusing to boot: DATABASE_NAME is "${process.env.DATABASE_NAME}". This suite seeds content and needs a database whose name ends in _test.`,
  );
}

// Strapi refuses to start without these. Real values live in .env on a real
// deployment; a test only needs them to be present and long enough.
const FILLER = "owner-scope-test-value-long-enough";
process.env.APP_KEYS ??= `${FILLER}1,${FILLER}2`;
process.env.API_TOKEN_SALT ??= FILLER;
process.env.ADMIN_JWT_SECRET ??= FILLER;
process.env.TRANSFER_TOKEN_SALT ??= FILLER;
process.env.JWT_SECRET ??= FILLER;
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef";
// No profile to notify, and the seeds below would fire one request per publish.
delete process.env.PROFILE_REVALIDATE_URL;

// `compileStrapi()` returns the whole build context, not a path, and
// `createStrapi` takes that context as-is — this is what Strapi's own CLI does.
// Wrapping it as `{ appDir }` makes `resolveWorkingDirectories` call
// `path.resolve()` on an object.
const { compileStrapi, createStrapi } = require("@strapi/strapi") as {
  compileStrapi: () => Promise<Record<string, unknown>>;
  createStrapi: (context: Record<string, unknown>) => { load: () => Promise<Core.Strapi> };
};

// Copied from `owner-scope.ts` rather than imported, and the duplication is the
// point. Application source is written the way Strapi expects — relative imports
// with no file extension — which only resolves because Strapi's own build
// transpiles it. Importing one constant from it drags the whole `src/` tree into
// plain Node, where ESM demands an extension on every one of those imports.
// Strapi itself is booted through `compileStrapi()` below, which does that
// transpilation properly, so nothing else here touches app source.
//
// Drift is not silent: `before` looks the role up by this code, and a mismatch
// leaves `role` undefined and fails the suite on its first line.
const EDITOR_ROLE_CODE = "mbs-editor-konten";

const READ = "plugin::content-manager.explorer.read";
const CREATE = "plugin::content-manager.explorer.create";
const DELETE = "plugin::content-manager.explorer.delete";
const PUBLISH = "plugin::content-manager.explorer.publish";
const UPDATE = "plugin::content-manager.explorer.update";
const KOLABORASI = "api::kolaborasi.kolaborasi";

type AdminUser = { id: number; roles?: { code?: string }[] };
type Rule = { action: string; subject: string; conditions?: unknown; fields?: unknown };
type Invite = { id: number; ownerKey: string; status: string; judul: string; alamat: string };

let strapi: Core.Strapi;
let editor: AdminUser;
let smkEditor: AdminUser;

/** Runs a write the way a request does, so the document middleware sees an actor. */
const as = (user: AdminUser, write: () => Promise<unknown>) =>
  strapi.requestContext.run({ state: { user } } as never, async () => {
    await write();
  });

const rulesFor = async (user: AdminUser): Promise<Rule[]> => {
  const permissions = strapi.service("admin::permission") as unknown as {
    engine: { generateUserAbility(user: AdminUser): Promise<{ rules: Rule[] }> };
  };
  const ability = await permissions.engine.generateUserAbility(user);
  return ability.rules;
};

/** An editor-role admin user assigned one owner. */
const createEditor = async (ownerKey: "smp" | "smk") => {
  const role: { id: number } = await strapi.db
    .query("admin::role")
    .findOne({ where: { code: EDITOR_ROLE_CODE } });

  const created: { id: number } = await strapi.db.query("admin::user").create({
    data: {
      firstname: "Uji",
      lastname: "Editor",
      email: `owner-scope-${ownerKey}-${Date.now()}@example.test`,
      password: "not-a-real-login",
      isActive: true,
      roles: [role.id],
    },
  });

  // The document service, not `db.query`: the query engine treats every
  // non-scalar value as a relation, so the `owners` component reaches
  // `toIdArray` and fails with "Invalid id, expected a string or integer".
  await strapi.documents("api::penugasan-editor.penugasan-editor").create({
    data: { adminUser: created.id, owners: [{ ownerKey }] },
  });

  const user: AdminUser = await strapi.db
    .query("admin::user")
    .findOne({ where: { id: created.id }, populate: ["roles"] });
  return user;
};

before(async () => {
  strapi = await createStrapi(await compileStrapi()).load();
  editor = await createEditor("smp");
  smkEditor = await createEditor("smk");
});

after(async () => {
  await strapi?.destroy();
});

void describe("owner scope", () => {
  // The assertion with teeth. "A user with no assignment is granted nothing"
  // would pass for an incidental reason — an unrecognised condition result is
  // dropped and the permission is never registered — and so proves little. This
  // one fails if the handler ever starts returning `true`, which would widen
  // access to every owner rather than narrowing it.
  void it("narrows an editor assigned only smp to smp", async () => {
    const rules = await rulesFor(editor);
    const read = rules.find(
      (rule) => rule.action === READ && rule.subject === "api::berita.berita",
    );

    assert.ok(read, "expected a read rule on Berita");
    assert.deepEqual(read.conditions, { $and: [{ $or: [{ ownerKey: { $in: ["smp"] } }] }] });
  });

  void it("gives no create and no delete on pages and sites, but keeps publish", async () => {
    const rules = await rulesFor(editor);
    const on = (subject: string) =>
      rules.filter((rule) => rule.subject === subject).map((rule) => rule.action);

    assert.ok(!on("api::page.page").includes(CREATE));
    assert.ok(!on("api::page.page").includes(DELETE));
    assert.ok(on("api::page.page").includes(PUBLISH));
    assert.ok(!on("api::site.site").includes(CREATE));
    assert.ok(on("api::berita.berita").includes(CREATE));
  });

  void it("refuses a create on an owner the editor is not assigned", async () => {
    const create = (ownerKey: "smp" | "mbs") =>
      strapi.documents("api::berita.berita").create({
        data: {
          ownerKey,
          title: `Uji ${ownerKey} ${Date.now()}`,
          slug: `uji-${ownerKey}-${Date.now()}`,
          body: "Isi uji.",
        },
      });

    await assert.rejects(
      as(editor, () => create("mbs")),
      /tidak ditugaskan/,
    );
    await assert.doesNotReject(as(editor, () => create("smp")));
  });

  void it("refuses to move an owner once the document has been published", async () => {
    const published = await strapi.documents("api::berita.berita").create({
      data: {
        ownerKey: "smp",
        title: `Uji terbit ${Date.now()}`,
        slug: `uji-terbit-${Date.now()}`,
        body: "Isi uji.",
      },
      status: "published",
    });

    const move = () =>
      strapi
        .documents("api::berita.berita")
        .update({ documentId: published.documentId, data: { ownerKey: "smk" } });

    await assert.rejects(as(editor, move), /pernah terbit/);
  });
});

/** An SMA article with these ticks, published, as the SMA editor's publish would leave it. */
const publishedArticle = async (collaborators: ("smp" | "smk" | "sma" | "mbs")[]) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const article = await strapi.documents("api::berita.berita").create({
    data: {
      ownerKey: "sma",
      title: `Uji kolaborasi ${stamp}`,
      slug: `uji-kolaborasi-${stamp}`,
      body: "Isi uji.",
      collaborators: collaborators.map((ownerKey) => ({ ownerKey })),
    },
  });
  await strapi.documents("api::berita.berita").publish({ documentId: article.documentId });
  return article.documentId;
};

const invitesOf = (documentId: string): Promise<Invite[]> =>
  strapi.db.query(KOLABORASI).findMany({
    where: { berita: { documentId } },
    select: ["id", "ownerKey", "status", "judul", "alamat"],
    orderBy: { ownerKey: "asc" },
  });

const accept = (invite: Invite | undefined) => {
  // An undefined id would widen the `where` to every row.
  assert.ok(invite, "expected an invite to accept");
  return strapi.db
    .query(KOLABORASI)
    .update({ where: { id: invite.id }, data: { status: "diterima" } });
};

const tick = (documentId: string, collaborators: "smp"[] | "smk"[]) =>
  strapi.documents("api::berita.berita").update({
    documentId,
    data: { collaborators: collaborators.map((ownerKey) => ({ ownerKey })) },
  });

void describe("collaboration", () => {
  // The owner filter does the hiding: an SMK editor's Kolaborasi rules carry
  // SMK's key and nothing else, so SMA's invites never reach its list.
  void it("scopes an smk editor to its own invites, status only, no create", async () => {
    const rules = (await rulesFor(smkEditor)).filter((rule) => rule.subject === KOLABORASI);
    const read = rules.find((rule) => rule.action === READ);
    const update = rules.find((rule) => rule.action === UPDATE);

    assert.deepEqual(read?.conditions, { $and: [{ $or: [{ ownerKey: { $in: ["smk"] } }] }] });
    assert.deepEqual(update?.conditions, { $and: [{ $or: [{ ownerKey: { $in: ["smk"] } }] }] });
    assert.deepEqual(update?.fields, ["status"]);
    assert.ok(rules.some((rule) => rule.action === DELETE));
    assert.ok(!rules.some((rule) => rule.action === CREATE));
  });

  void it("refuses the umbrella, the article's own owner, and a school twice", async () => {
    await assert.rejects(publishedArticle(["mbs"]), /MBS/);
    await assert.rejects(publishedArticle(["sma"]), /Pemilik artikel/);
    await assert.rejects(publishedArticle(["smk", "smk"]), /sekali/);
  });

  void it("invites on publish and re-asks accepted schools on the next one", async () => {
    const documentId = await publishedArticle(["smp", "smk"]);
    const invites = await invitesOf(documentId);

    assert.deepEqual(
      invites.map(({ ownerKey, status }) => ({ ownerKey, status })),
      [
        { ownerKey: "smk", status: "menunggu" },
        { ownerKey: "smp", status: "menunggu" },
      ],
    );
    assert.match(invites[0]?.alamat ?? "", /^https:\/\/sma\.[^/]+\/berita\/uji-kolaborasi-/);

    await accept(invites[0]);
    await strapi.documents("api::berita.berita").publish({ documentId });

    const reasked = await invitesOf(documentId);
    assert.ok(reasked.every((invite) => invite.status === "menunggu"));
  });

  void it("drops an unticked school on the next publish, not on save", async () => {
    const documentId = await publishedArticle(["smp", "smk"]);

    await tick(documentId, ["smp"]);
    assert.equal((await invitesOf(documentId)).length, 2);

    await strapi.documents("api::berita.berita").publish({ documentId });
    assert.deepEqual(
      (await invitesOf(documentId)).map((invite) => invite.ownerKey),
      ["smp"],
    );
  });

  void it("invites a school that left again on the next publish", async () => {
    const documentId = await publishedArticle(["smk"]);
    const [invite] = await invitesOf(documentId);
    assert.ok(invite, "expected an invite to leave");
    await strapi.db.query(KOLABORASI).delete({ where: { id: invite.id } });

    await strapi.documents("api::berita.berita").publish({ documentId });
    assert.deepEqual(
      (await invitesOf(documentId)).map(({ ownerKey, status }) => ({ ownerKey, status })),
      [{ ownerKey: "smk", status: "menunggu" }],
    );
  });

  void it("removes every invite and every tick on unpublish", async () => {
    const documentId = await publishedArticle(["smp", "smk"]);
    const rows = await invitesOf(documentId);

    await strapi.documents("api::berita.berita").unpublish({ documentId });

    const draft: { collaborators?: unknown[] } | null = await strapi.db
      .query("api::berita.berita")
      .findOne({ where: { documentId }, populate: ["collaborators"] });
    const leftover = await strapi.db
      .query(KOLABORASI)
      .count({ where: { id: { $in: rows.map((row) => row.id) } } });

    assert.equal(leftover, 0);
    assert.deepEqual(draft?.collaborators, []);
  });

  void it("keeps the invites on the published article when a draft is discarded", async () => {
    const documentId = await publishedArticle(["smp", "smk"]);
    await tick(documentId, ["smp"]);
    await strapi.documents("api::berita.berita").discardDraft({ documentId });

    const published: { kolaborasi?: unknown[] } | null = await strapi.db
      .query("api::berita.berita")
      .findOne({
        where: { documentId, publishedAt: { $notNull: true } },
        populate: ["kolaborasi"],
      });
    assert.equal(published?.kolaborasi?.length, 2);
  });

  // The profile's two queries, in object form, against published rows only —
  // what the public REST endpoint reads. The suite has no HTTP listener, so the
  // public role's permission is checked separately.
  // Pengumuman runs through the same hooks. Its own case proves the second
  // relation is wired, and that its address is `/berita/` too: the profile has no
  // `/pengumuman` route, both kinds share one listing and one detail page.
  void it("invites, lists and clears a pengumuman the same way", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { documentId } = await strapi.documents("api::pengumuman.pengumuman").create({
      data: {
        ownerKey: "sma",
        title: `Uji pengumuman ${stamp}`,
        slug: `uji-pengumuman-${stamp}`,
        body: "Isi uji.",
        collaborators: [{ ownerKey: "smk" }],
      },
    });
    await strapi.documents("api::pengumuman.pengumuman").publish({ documentId });

    const invites = (): Promise<Invite[]> =>
      strapi.db.query(KOLABORASI).findMany({
        where: { pengumuman: { documentId } },
        select: ["id", "ownerKey", "status", "judul", "alamat"],
      });

    const [invite] = await invites();
    assert.equal(invite?.ownerKey, "smk");
    assert.match(invite?.alamat ?? "", /^https:\/\/sma\.[^/]+\/berita\/uji-pengumuman-/);
    await accept(invite);

    const listed = await strapi.documents("api::pengumuman.pengumuman").findMany({
      status: "published",
      filters: {
        documentId,
        kolaborasi: { ownerKey: { $eq: "smk" }, status: { $eq: "diterima" } },
      },
    });
    assert.equal(listed.length, 1);

    await strapi.documents("api::pengumuman.pengumuman").unpublish({ documentId });
    assert.equal((await invites()).length, 0);
  });

  void it("answers the profile's listing and badge queries from the published article", async () => {
    const documentId = await publishedArticle(["smp", "smk"]);
    const invites = await invitesOf(documentId);
    await accept(invites.find((invite) => invite.ownerKey === "smk"));

    const published: { kolaborasi?: unknown[] } | null = await strapi.db
      .query("api::berita.berita")
      .findOne({
        where: { documentId, publishedAt: { $notNull: true } },
        populate: ["kolaborasi"],
      });
    assert.equal(published?.kolaborasi?.length, 2);

    const listing = (ownerKey: "smp" | "smk") =>
      strapi.documents("api::berita.berita").findMany({
        status: "published",
        filters: {
          documentId,
          $or: [
            { ownerKey: { $eq: ownerKey } },
            { kolaborasi: { ownerKey: { $eq: ownerKey }, status: { $eq: "diterima" } } },
          ],
        },
        populate: {
          kolaborasi: { filters: { status: { $eq: "diterima" } }, fields: ["ownerKey"] },
        },
      });

    const [smk] = await listing("smk");
    assert.deepEqual(
      smk?.kolaborasi?.map((row: { ownerKey?: string }) => row.ownerKey),
      ["smk"],
    );
    assert.equal((await listing("smp")).length, 0);

    const role: { id: number } = await strapi.db
      .query("plugin::users-permissions.role")
      .findOne({ where: { type: "public" } });
    const find = await strapi.db
      .query("plugin::users-permissions.permission")
      .findOne({ where: { action: `${KOLABORASI}.find`, role: role.id } });
    assert.ok(find, "the public role must be able to find Kolaborasi");
  });
});
