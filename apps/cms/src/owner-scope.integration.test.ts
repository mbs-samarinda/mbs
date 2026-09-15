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

type AdminUser = { id: number; roles?: { code?: string }[] };
type Rule = { action: string; subject: string; conditions?: unknown };

let strapi: Core.Strapi;
let editor: AdminUser;

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

before(async () => {
  strapi = await createStrapi(await compileStrapi()).load();

  const role: { id: number } = await strapi.db
    .query("admin::role")
    .findOne({ where: { code: EDITOR_ROLE_CODE } });

  const created: { id: number } = await strapi.db.query("admin::user").create({
    data: {
      firstname: "Uji",
      lastname: "Editor",
      email: `owner-scope-${Date.now()}@example.test`,
      password: "not-a-real-login",
      isActive: true,
      roles: [role.id],
    },
  });

  // The document service, not `db.query`: the query engine treats every
  // non-scalar value as a relation, so the `owners` component reaches
  // `toIdArray` and fails with "Invalid id, expected a string or integer".
  await strapi.documents("api::penugasan-editor.penugasan-editor").create({
    data: { adminUser: created.id, owners: [{ ownerKey: "smp" }] },
  });

  editor = await strapi.db
    .query("admin::user")
    .findOne({ where: { id: created.id }, populate: ["roles"] });
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
