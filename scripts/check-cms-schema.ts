// Fails when a CMS component or content-type field is removed or changes
// `type` against a base commit: node scripts/check-cms-schema.ts <base-ref>
//
// Strapi syncs its tables to these files on boot, so either change drops the
// column and the content in it. A rename or retype is done with a new field
// plus a backfill instead. A deliberate break is let through by the PR label
// the workflow checks, not by this script.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Schema = { attributes: Record<string, { type: string }> };
type Break = { file: string; field: string; from: string; to: string | null };

const schemaFile =
  /^apps\/cms\/src\/(components\/.+\.json|api\/.+\/content-types\/.+\/schema\.json)$/;

// A file missing from `head` counts as every one of its fields removed.
export function findBreaks(base: Map<string, Schema>, head: Map<string, Schema>): Break[] {
  const breaks: Break[] = [];
  for (const [file, schema] of base) {
    const after = head.get(file)?.attributes ?? {};
    for (const [field, { type }] of Object.entries(schema.attributes)) {
      const to = after[field]?.type ?? null;
      if (to !== type) breaks.push({ file, field, from: type, to });
    }
  }
  return breaks;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function lines(out: string): string[] {
  return out.split("\n").filter(Boolean);
}

function schemas(paths: string[], read: (path: string) => string): Map<string, Schema> {
  const found = new Map<string, Schema>();
  for (const path of paths.filter((p) => schemaFile.test(p))) {
    const schema: Schema = JSON.parse(read(path));
    found.set(path, schema);
  }
  return found;
}

if (import.meta.main) {
  const base = process.argv[2];
  if (!base) throw new Error("usage: node scripts/check-cms-schema.ts <base-ref>");
  const breaks = findBreaks(
    schemas(lines(git("ls-tree", "-r", "--name-only", base, "--", "apps/cms/src")), (p) =>
      git("show", `${base}:${p}`),
    ),
    schemas(lines(git("ls-files", "--", "apps/cms/src")), (p) => readFileSync(p, "utf8")),
  );
  for (const b of breaks) {
    console.error(
      `${b.file}: "${b.field}" ${b.to ? `changed type ${b.from} -> ${b.to}` : "removed"}`,
    );
  }
  if (breaks.length > 0) {
    console.error(
      "\nStrapi drops these columns on boot, and their content with them. Add a new field and" +
        "\nbackfill it instead, or add the schema-break-ok label if losing the content is intended.",
    );
    process.exit(1);
  }
  console.log("No CMS field removed or retyped.");
}
