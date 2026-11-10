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

const { before, describe, it } = require("node:test") as typeof import("node:test");
const assert = require("node:assert/strict") as typeof import("node:assert/strict");

// Booting Strapi runs its migrations and every seed, so this must never point at
// a database anybody works in. Defaults are set before Strapi loads `.env` —
// dotenv leaves an existing variable alone — and then checked, so a developer's
// own `DATABASE_NAME=mbs_cms` cannot reach this suite by accident.
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

const CREATE = "plugin::content-manager.explorer.create";
const DELETE = "plugin::content-manager.explorer.delete";
const PUBLISH = "plugin::content-manager.explorer.publish";
const KOLABORASI = "api::kolaborasi.kolaborasi";

type AdminUser = { id: number; roles?: { code?: string }[] };
type Rule = { action: string; subject: string };
type Invite = { id: number; ownerKey: string; status: string; judul: string; alamat: string };

let strapi: Core.Strapi;
let editor: AdminUser;
let smkEditor: AdminUser;
let smaEditor: AdminUser;

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

type ManagerAction = "clone" | "update" | "find";

const refuse = (status: string) => () => {
  throw new Error(status);
};

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Calls a Content Manager controller the way its admin route does: with the
 * actor's real ability on `ctx.state`, inside a request context. Routing and the
 * admin token are the only parts skipped, so the permission checks under test
 * are the ones an editor's browser reaches.
 */
const contentManager = async (
  user: AdminUser,
  action: ManagerAction,
  params: Record<string, string>,
  body: Record<string, unknown>,
) => {
  const permissions = strapi.service("admin::permission") as unknown as {
    engine: { generateUserAbility(user: AdminUser): Promise<unknown> };
  };
  const ctx = {
    state: { user, userAbility: await permissions.engine.generateUserAbility(user) },
    params,
    query: {},
    request: { body, query: {} },
    body: undefined as unknown,
    forbidden: refuse("forbidden"),
    notFound: refuse("not found"),
    badRequest: refuse("bad request"),
  };
  const controller = strapi.plugin("content-manager").controller("collection-types") as Record<
    ManagerAction,
    (context: typeof ctx) => Promise<void>
  >;
  await strapi.requestContext.run(ctx as never, () => controller[action](ctx));
  return ctx.body;
};

/** The owners of the entries an admin user's list view shows for one type. */
const listedOwners = async (user: AdminUser, model: string) => {
  const body = (await contentManager(user, "find", { model }, {})) as {
    results: { ownerKey: string }[];
  };
  return body.results.map((row) => row.ownerKey);
};

const boot = () =>
  (strapi.app as { bootstrap: (context: { strapi: Core.Strapi }) => Promise<void> }).bootstrap({
    strapi,
  });

/** An editor-role admin user assigned one owner. */
const createEditor = async (ownerKey: "smp" | "smk" | "sma") => {
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

// No `strapi.destroy()` afterwards: Strapi reads each written entry back for
// its events after the write returns, and closing the pool under that read
// failed CI at random with only "test failed". `test:integration` passes
// `--test-force-exit` to end the process instead, so run it through that
// script. A bare `node --test` on this file never exits.
before(async () => {
  strapi = await createStrapi(await compileStrapi()).load();
  editor = await createEditor("smp");
  smkEditor = await createEditor("smk");
  smaEditor = await createEditor("sma");
});

void describe("owner scope", () => {
  // Also the guard against the condition ever answering `true`, which would
  // widen an editor to every owner rather than narrowing them.
  void it("lists only smp entries to an editor assigned only smp", async () => {
    const owners = await listedOwners(editor, "api::berita.berita");

    assert.ok(owners.length > 0, "expected the seeded smp articles");
    assert.deepEqual([...new Set(owners)], ["smp"]);
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

  void it("refuses a clone that lands on an owner the editor is not assigned", async () => {
    const article = (ownerKey: "smp" | "sma") =>
      strapi.documents("api::berita.berita").create({
        data: {
          ownerKey,
          title: `Uji salin ${unique()}`,
          slug: `uji-salin-${unique()}`,
          body: "Isi.",
        },
      });
    const clone = (sourceId: string, data: Record<string, unknown> = {}) =>
      contentManager(
        editor,
        "clone",
        { model: "api::berita.berita", sourceId },
        { title: "Salinan", slug: `salinan-${unique()}`, ...data },
      );

    const sma = await article("sma");
    const smp = await article("smp");

    await assert.rejects(clone(sma.documentId), /tidak ditugaskan/);
    await assert.rejects(clone(smp.documentId, { ownerKey: "sma" }), /tidak ditugaskan/);
    await assert.rejects(clone(sma.documentId, { ownerKey: "smp" }), /tidak ditugaskan/);
    await assert.doesNotReject(clone(smp.documentId));
  });

  // A request with no admin user on it is an API token, a content-API call, or
  // something not yet thought of. None of them may write an owner.
  void it("refuses a write from a request with no recognised admin user", async () => {
    const create = () =>
      strapi.documents("api::berita.berita").create({
        data: {
          ownerKey: "smp",
          title: `Uji tanpa pengguna ${Date.now()}`,
          slug: `uji-tanpa-pengguna-${Date.now()}`,
          body: "Isi uji.",
        },
      });
    const inRequest = (state: Record<string, unknown>) =>
      strapi.requestContext.run({ state } as never, create);

    await assert.rejects(inRequest({}), /tidak dikenali/);
    await assert.rejects(inRequest({ user: {} }), /tidak dikenali/);
    await assert.rejects(inRequest({ user: { id: "1", roles: "x" } }), /tidak dikenali/);
    await assert.doesNotReject(create());
  });

  void it("refuses a relation to another owner's entry", async () => {
    const own = await strapi
      .documents("api::pencapaian.pencapaian")
      .findFirst({ filters: { ownerKey: "smp" } });
    const theirs = await strapi
      .documents("api::berita.berita")
      .findFirst({ filters: { ownerKey: "sma" } });
    assert.ok(own && theirs, "expected seeded smp pencapaian and sma berita");
    await strapi
      .documents("api::pencapaian.pencapaian")
      .update({ documentId: own.documentId, data: { berita: null } });

    const error: unknown = await contentManager(
      editor,
      "update",
      { model: "api::pencapaian.pencapaian", id: own.documentId },
      { berita: { connect: [{ documentId: theirs.documentId }] } },
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    const after = await strapi
      .documents("api::pencapaian.pencapaian")
      .findOne({ documentId: own.documentId, populate: ["berita"] });
    assert.notEqual(after?.berita?.documentId, theirs.documentId, "the relation must not be saved");
    assert.match(String(error), /milik "sma"/);
  });

  // Only the collaboration hooks link an invite to an article. An editor who
  // could would pull another school's invite onto their own article.
  void it("refuses an editor linking an invite to an article", async () => {
    const stamp = unique();
    const { documentId: smkArticle } = await strapi.documents("api::berita.berita").create({
      data: {
        ownerKey: "smk",
        title: `Uji undang sma ${stamp}`,
        slug: `uji-undang-sma-${stamp}`,
        body: "Isi.",
        collaborators: [{ ownerKey: "sma" }],
      },
    });
    await strapi.documents("api::berita.berita").publish({ documentId: smkArticle });
    const invite: { documentId: string } | null = await strapi.db
      .query(KOLABORASI)
      .findOne({ where: { berita: { documentId: smkArticle } }, select: ["documentId"] });
    assert.ok(invite, "expected an sma invite");
    const own = await strapi.documents("api::berita.berita").create({
      data: { ownerKey: "smp", title: `Uji ${stamp}`, slug: `uji-${stamp}`, body: "Isi." },
    });

    await assert.rejects(
      contentManager(
        editor,
        "update",
        { model: "api::berita.berita", id: own.documentId },
        { kolaborasi: { connect: [{ documentId: invite.documentId }] } },
      ),
      /undangan/i,
    );
    const after: { berita?: { documentId?: string } } | null = await strapi.db
      .query(KOLABORASI)
      .findOne({ where: { documentId: invite.documentId }, populate: ["berita"] });
    assert.equal(after?.berita?.documentId, smkArticle, "the invite must stay on its article");
  });

  void it("refuses an owner that is present but not an owner key", async () => {
    const draft = await strapi.documents("api::berita.berita").create({
      data: { ownerKey: "smp", title: `Uji ${unique()}`, slug: `uji-${unique()}`, body: "Isi." },
    });
    const write = (ownerKey: unknown) => () =>
      strapi
        .documents("api::berita.berita")
        .update({ documentId: draft.documentId, data: { ownerKey } as never });

    await assert.rejects(as(editor, write(null)), /pemilik/i);
    await assert.rejects(as(editor, write(7)), /pemilik/i);
    const row: { ownerKey: string } | null = await strapi.db
      .query("api::berita.berita")
      .findOne({ where: { documentId: draft.documentId }, select: ["ownerKey"] });
    assert.equal(row?.ownerKey, "smp");
  });

  // Publishing writes the invitees' rows from inside the editor's request. They
  // carry other owners' keys, so they must not reach the owner check.
  void it("lets an sma editor publish an article that invites smk", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await assert.doesNotReject(
      as(smaEditor, async () => {
        const { documentId } = await strapi.documents("api::berita.berita").create({
          data: {
            ownerKey: "sma",
            title: `Uji undang ${stamp}`,
            slug: `uji-undang-${stamp}`,
            body: "Isi uji.",
            collaborators: [{ ownerKey: "smk" }],
          },
        });
        await strapi.documents("api::berita.berita").publish({ documentId });
      }),
    );
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
  // The owner filter does the hiding: an SMK editor's list never shows SMA's
  // invites, and saving an invite changes its status and nothing else.
  void it("scopes an smk editor to its own invites, status only, no create", async () => {
    const [invite] = await invitesOf(await publishedArticle(["smk"]));
    assert.ok(invite, "expected an invite");

    assert.deepEqual([...new Set(await listedOwners(smkEditor, KOLABORASI))], ["smk"]);

    // Through the permission checker rather than the update route: the Content
    // Manager reads a body field named `status` as the publication status and
    // refuses "diterima" before any permission is consulted.
    const permissions = strapi.service("admin::permission") as unknown as {
      engine: { generateUserAbility(user: AdminUser): Promise<unknown> };
    };
    const checker = strapi
      .plugin("content-manager")
      .service("permission-checker")
      .create({
        userAbility: await permissions.engine.generateUserAbility(smkEditor),
        model: KOLABORASI,
      }) as {
      sanitizeUpdateInput(entity: unknown): (body: unknown) => Promise<Record<string, unknown>>;
    };
    assert.deepEqual(
      await checker.sanitizeUpdateInput(invite)({ status: "diterima", judul: "Diubah penerima" }),
      { status: "diterima" },
    );

    const rules = (await rulesFor(smkEditor)).filter((rule) => rule.subject === KOLABORASI);
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
    assert.match(
      invites[0]?.alamat ?? "",
      /^https:\/\/sma\.[^/]+\/artikel\/berita\/uji-kolaborasi-/,
    );

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
  // relation is wired, and that its address names its own type.
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
    assert.match(
      invite?.alamat ?? "",
      /^https:\/\/sma\.[^/]+\/artikel\/pengumuman\/uji-pengumuman-/,
    );
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

void describe("permissions", () => {
  // The admin edit view sends the whole page back, slug included. The field is
  // dropped from the save rather than failing it.
  void it("saves an editor's page without changing its slug", async () => {
    const page = await strapi
      .documents("api::page.page")
      .findFirst({ filters: { ownerKey: "smp", slug: "kontak" }, status: "draft" });
    assert.ok(page, "expected the smp kontak page");
    const title = `Kontak ${Date.now()}`;

    await contentManager(
      editor,
      "update",
      { model: "api::page.page", id: page.documentId },
      { title, slug: "home" },
    );

    const saved = await strapi
      .documents("api::page.page")
      .findOne({ documentId: page.documentId, status: "draft" });
    assert.equal(saved?.title, title);
    assert.equal(saved?.slug, "kontak");
  });

  void it("repairs an editor role left with no permissions", async () => {
    const role: { id: number } = await strapi.db
      .query("admin::role")
      .findOne({ where: { code: EDITOR_ROLE_CODE } });
    await strapi.db.query("admin::permission").deleteMany({ where: { role: role.id } });
    await assert.rejects(listedOwners(editor, "api::berita.berita"), /forbidden/);

    await boot();

    assert.deepEqual([...new Set(await listedOwners(editor, "api::berita.berita"))], ["smp"]);
  });

  void it("leaves correct permissions untouched on the next boot", async () => {
    const ids = async () => {
      const rows: { id: number }[] = await strapi.db.query("admin::permission").findMany({
        where: { role: { code: EDITOR_ROLE_CODE } },
        select: ["id"],
        orderBy: { id: "asc" },
      });
      return rows.map((row) => row.id);
    };
    const held = await ids();

    await boot();

    assert.deepEqual(await ids(), held);
  });

  void it("takes public read off a type that is not on the list", async () => {
    const role: { id: number } = await strapi.db
      .query("plugin::users-permissions.role")
      .findOne({ where: { type: "public" } });
    const permissions = strapi.db.query("plugin::users-permissions.permission");
    const action = "api::penugasan-editor.penugasan-editor.find";
    await permissions.create({ data: { action, role: role.id } });

    await boot();

    assert.equal(await permissions.count({ where: { action, role: role.id } }), 0);
    assert.equal(
      await permissions.count({ where: { action: `${KOLABORASI}.find`, role: role.id } }),
      1,
    );
  });

  // 4820194 is `BOOT_LOCK` in `index.ts`, copied for the reason given at the top.
  void it("waits for another instance's boot to finish", async () => {
    const knex = strapi.db.connection;
    const connection: unknown = await knex.client.acquireConnection();
    try {
      await knex.raw("select pg_advisory_lock(4820194)").connection(connection);
      let finished = false;
      const booting = boot().then(() => {
        finished = true;
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
      assert.equal(finished, false, "boot must wait while the lock is held");

      await knex.raw("select pg_advisory_unlock(4820194)").connection(connection);
      await booting;
      assert.equal(finished, true);
    } finally {
      await knex.client.releaseConnection(connection);
    }
  });

  // A lock left behind by a hung instance must stop the boot with a reason,
  // not hang the deploy.
  void it("gives up on a boot lock held too long", async () => {
    const knex = strapi.db.connection;
    const connection: unknown = await knex.client.acquireConnection();
    process.env.BOOT_LOCK_TIMEOUT = "1s";
    try {
      await knex.raw("select pg_advisory_lock(4820194)").connection(connection);
      const outcome = await Promise.race([
        boot().then(
          () => "booted",
          (error: unknown) => String(error),
        ),
        new Promise((resolve) => {
          setTimeout(resolve, 5000, "still waiting");
        }),
      ]);
      assert.match(String(outcome), /boot lock/);
    } finally {
      delete process.env.BOOT_LOCK_TIMEOUT;
      await knex.raw("select pg_advisory_unlock(4820194)").connection(connection);
      await knex.client.releaseConnection(connection);
    }
  });
});

void describe("links", () => {
  const UNSAFE = [
    "javascript:alert(1)",
    "//evil.example",
    "/\\evil.example",
    "data:text/html,x",
    "http://example.com",
  ];
  const SAFE = [
    "",
    "/",
    "/kontak",
    "#daftar",
    "https://wa.me/628120000000",
    "mailto:a@b.id",
    "tel:+62541",
  ];

  // Every link field carries the rule, so a typo in one copy of the pattern
  // shows here rather than on a live page. The hero allows site paths only.
  void it("gives every link field the same rule", () => {
    const fields = Object.values(strapi.components).flatMap((component) =>
      Object.entries(component.attributes)
        .filter(([name]) => /href/i.test(name))
        .map(([name, attribute]) => ({
          field: `${component.uid}.${name}`,
          regex: "regex" in attribute ? attribute.regex : undefined,
        })),
    );
    assert.ok(fields.length >= 6, "expected the link fields");

    for (const { field, regex } of fields) {
      assert.ok(typeof regex === "string", `${field} has no regex`);
      const pattern = new RegExp(regex);
      for (const href of UNSAFE) assert.ok(!pattern.test(href), `${field} accepts ${href}`);
      const safe = field === "blocks.hero.secondaryHref" ? ["", "/", "/kontak", "#daftar"] : SAFE;
      for (const href of safe) assert.ok(pattern.test(href), `${field} refuses ${href}`);
    }
  });

  void it("refuses a menu link with any other scheme", async () => {
    const site = await strapi
      .documents("api::site.site")
      .findFirst({ filters: { ownerKey: "smp" } });
    assert.ok(site, "expected the smp site");
    const save = (href: string) =>
      strapi.documents("api::site.site").update({
        documentId: site.documentId,
        data: { menu: [{ label: "Uji", href, links: [{ label: "Uji", href }] }] },
      });

    for (const href of UNSAFE) await assert.rejects(save(href), { name: "ValidationError" }, href);
    for (const href of SAFE.filter(Boolean)) await assert.doesNotReject(save(href), href);
  });

  // Strapi does not validate a draft, so the rule bites at publish: an unsafe
  // link can sit in a draft but never reach the public copy.
  void it("refuses to publish a section link with another scheme", async () => {
    const page = await strapi
      .documents("api::page.page")
      .findFirst({ filters: { ownerKey: "smp", slug: "galeri" }, status: "draft" });
    assert.ok(page, "expected the smp galeri page");
    const save = async (linkHref: string) => {
      await strapi.documents("api::page.page").update({
        documentId: page.documentId,
        data: {
          blocks: [
            {
              __component: "blocks.news",
              limit: 3,
              head: { heading: "Uji", linkLabel: "Uji", linkHref },
            },
          ],
        },
      });
      await strapi.documents("api::page.page").publish({ documentId: page.documentId });
    };

    for (const href of UNSAFE) await assert.rejects(save(href), { name: "ValidationError" }, href);
    for (const href of SAFE) await assert.doesNotReject(save(href), href);
  });
});

void describe("artikel", () => {
  // The type is in the address now, so two types may share a slug.
  void it("lets an opini reuse a berita's slug on the same owner", async () => {
    const slug = `uji-slug-${Date.now()}`;
    const fields = { ownerKey: "smp" as const, title: "Uji slug", slug, body: "Isi uji." };

    await strapi.documents("api::berita.berita").create({ data: fields });
    await assert.doesNotReject(
      strapi.documents("api::opini.opini").create({
        data: { ...fields, authorName: "Uji", authorRole: "Guru" },
      }),
    );
    await assert.rejects(
      strapi.documents("api::opini.opini").create({
        data: { ...fields, authorName: "Uji", authorRole: "Guru" },
      }),
      /sudah dipakai/,
    );
  });

  // Plants a database as it stood before Opini, clears the marker, and boots
  // again through the app's own bootstrap — the path a real deploy takes.
  void it("moves a pre-Opini database onto the Artikel addresses, once", async () => {
    const site = await strapi
      .documents("api::site.site")
      .findFirst({ filters: { ownerKey: "sma" } });
    assert.ok(site, "expected the sma site");
    await strapi.documents("api::site.site").update({
      documentId: site.documentId,
      data: {
        menu: [],
        footerColumns: [{ heading: "Informasi", links: [{ label: "Berita", href: "/berita" }] }],
      },
    });

    const page = await strapi
      .documents("api::page.page")
      .findFirst({ filters: { ownerKey: "sma", slug: "artikel" }, status: "draft" });
    assert.ok(page, "expected the sma artikel page");
    await strapi.db
      .query("api::page.page")
      .updateMany({ where: { documentId: page.documentId }, data: { slug: "berita" } });

    const documentId = await publishedArticle(["smk"]);
    const [invite] = await invitesOf(documentId);
    assert.ok(invite, "expected an invite");
    await strapi.db.query(KOLABORASI).update({
      where: { id: invite.id },
      data: { alamat: invite.alamat.replace("/artikel/berita/", "/berita/") },
    });

    await strapi.db
      .query("shared.section-head")
      .updateMany({ where: { linkHref: "/artikel" }, data: { linkHref: "/berita" } });

    const store = strapi.store({ type: "plugin", name: "mbs-seed" });
    await store.delete({ key: "artikel" });
    await boot();

    const read = () =>
      strapi.documents("api::site.site").findOne({
        documentId: site.documentId,
        populate: { menu: { populate: ["links"] }, footerColumns: { populate: ["links"] } },
      });
    const after = await read();
    // An empty menu gets the seeded one, Artikel group included.
    const artikel = after?.menu?.find((item: { label?: string }) => item.label === "Artikel");
    assert.ok((after?.menu?.length ?? 0) > 1, "expected the seeded menu");
    assert.equal(artikel?.links?.length, 4);
    assert.deepEqual(
      after?.footerColumns?.[0]?.links?.map((link: { href?: string }) => link.href),
      ["/artikel", "/artikel/berita", "/artikel/pengumuman", "/artikel/opini"],
    );

    const pages: { slug: string }[] = await strapi.db
      .query("api::page.page")
      .findMany({ where: { documentId: page.documentId }, select: ["slug"] });
    assert.ok(pages.length > 0 && pages.every((row) => row.slug === "artikel"));
    assert.equal(
      await strapi.db
        .query("api::page.page")
        .count({ where: { ownerKey: "sma", slug: "artikel", publishedAt: null } }),
      1,
      "the seed must not add a second artikel page beside the renamed one",
    );

    assert.equal(
      await strapi.db.query("shared.section-head").count({ where: { linkHref: "/berita" } }),
      0,
    );

    const [moved] = await invitesOf(documentId);
    assert.match(moved?.alamat ?? "", /^https:\/\/sma\.[^/]+\/artikel\/berita\/uji-kolaborasi-/);
    assert.equal(
      await strapi.db
        .query(KOLABORASI)
        .count({ where: { alamat: { $contains: "/artikel/artikel/" } } }),
      0,
      "an address already moved must not move again",
    );

    // A second boot with the marker set changes nothing.
    await boot();
    assert.deepEqual(await read(), after);
  });
});

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

void describe("database config", () => {
  const { env } = require("@strapi/utils") as Core.Config.Shared.ConfigParams;
  const { default: databaseConfig } =
    require("../config/database.ts") as typeof import("../config/database.ts");
  const loadWith = (changes: Record<string, string | undefined>) => {
    const saved = Object.fromEntries(Object.keys(changes).map((name) => [name, process.env[name]]));
    setEnv(changes);
    try {
      databaseConfig({ env });
    } finally {
      setEnv(saved);
    }
  };

  // An unset NODE_ENV never reaches the config: Strapi sets it to
  // "development" first, so local commands and this suite still pass.
  void it("refuses missing database settings outside development and test", () => {
    for (const mode of ["production", "staging"]) {
      assert.throws(
        () => loadWith({ NODE_ENV: mode, DATABASE_HOST: undefined }),
        /Missing database settings: DATABASE_HOST/,
      );
      assert.throws(() => loadWith({ NODE_ENV: mode, DATABASE_HOST: "" }), /DATABASE_HOST/);
    }
    for (const mode of ["development", "test"]) {
      assert.doesNotThrow(() => loadWith({ NODE_ENV: mode, DATABASE_HOST: undefined }));
    }
  });

  void it("refuses a DATABASE_CLIENT other than postgres", () => {
    const client = (value: string | undefined) => () =>
      loadWith({ NODE_ENV: "development", DATABASE_CLIENT: value });
    assert.throws(client("sqlite"), /DATABASE_CLIENT/);
    assert.throws(client("mysql"), /DATABASE_CLIENT/);
    for (const value of ["postgres", "", undefined]) assert.doesNotThrow(client(value));
  });
});
