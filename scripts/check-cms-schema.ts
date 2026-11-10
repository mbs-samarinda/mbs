// Fails when a CMS change would make Strapi drop stored content, compared with
// a base commit: node scripts/check-cms-schema.ts <base-ref>
//
// Strapi syncs its tables to these files on boot. A removed or retyped field
// loses its column, a field pointed at another component or relation target,
// or switched to another relation kind or owning side, loses its links, a
// component taken out of a dynamic zone loses those entries, a new
// collectionName starts an empty table, and turning off draftAndPublish
// deletes every draft. Renames and retypes are a new field plus a backfill
// instead. A deliberate break is let through by the PR label the workflow
// checks, not by this script.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Attribute = {
  type: string;
  component?: string;
  components?: string[];
  target?: string;
  relation?: string;
  mappedBy?: string;
  [setting: string]: unknown;
};
export type Schema = {
  collectionName?: string;
  options?: { draftAndPublish?: boolean };
  attributes: Record<string, Attribute>;
};
type Break = {
  file: string;
  field: string;
  reason: "removed" | "retyped" | "retargeted" | "zone-shrunk" | "table-renamed" | "drafts-dropped";
  detail: string;
};

const schemaFile =
  /^apps\/cms\/src\/(components\/.+\.json|api\/.+\/content-types\/.+\/schema\.json)$/;

// Where a field's data lives: which table, and for a relation, its kind
// (oneToOne -> manyToMany changes how Strapi stores the links) and which side
// owns the join table (adding or dropping mappedBy hands it over). inversedBy
// is left out: it names the other side without moving the links. Anything else
// (regex, required, default, labels) is a constraint or display setting and
// safe to change.
const storageKeys = ["component", "target", "relation", "mappedBy"] as const;

// A file missing from `head` counts as every one of its fields removed.
export function findBreaks(base: Map<string, Schema>, head: Map<string, Schema>): Break[] {
  const breaks: Break[] = [];
  for (const [file, before] of base) {
    const after = head.get(file);
    if (after && after.collectionName !== before.collectionName) {
      const detail = `${before.collectionName} -> ${after.collectionName}`;
      breaks.push({ file, field: "collectionName", reason: "table-renamed", detail });
    }
    // Strapi deletes every unpublished row when this goes from true to off,
    // and reads a missing value as off.
    if (
      after &&
      before.options?.draftAndPublish === true &&
      after.options?.draftAndPublish !== true
    ) {
      const detail = "turned off, unpublished drafts deleted";
      breaks.push({ file, field: "draftAndPublish", reason: "drafts-dropped", detail });
    }
    for (const [field, was] of Object.entries(before.attributes)) {
      const now = after?.attributes[field];
      if (!now) {
        breaks.push({ file, field, reason: "removed", detail: "removed" });
      } else if (now.type !== was.type) {
        breaks.push({ file, field, reason: "retyped", detail: `type ${was.type} -> ${now.type}` });
      } else {
        for (const key of storageKeys.filter((k) => now[k] !== was[k])) {
          const detail = `${key} ${String(was[key])} -> ${String(now[key])}`;
          breaks.push({ file, field, reason: "retargeted", detail });
        }
        for (const gone of (was.components ?? []).filter((c) => !now.components?.includes(c))) {
          breaks.push({ file, field, reason: "zone-shrunk", detail: `dropped ${gone}` });
        }
      }
    }
  }
  return breaks;
}

function isSchema(value: unknown): value is Schema {
  return (
    typeof value === "object" &&
    value !== null &&
    "attributes" in value &&
    typeof value.attributes === "object" &&
    value.attributes !== null &&
    Object.values(value.attributes).every(
      (a: unknown) =>
        typeof a === "object" && a !== null && "type" in a && typeof a.type === "string",
    )
  );
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
    const json: unknown = JSON.parse(read(path));
    if (!isSchema(json))
      throw new Error(`${path}: not a Strapi schema (no attributes with a type)`);
    found.set(path, json);
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
    console.error(`${b.file}: "${b.field}" ${b.detail}`);
  }
  if (breaks.length > 0) {
    console.error(
      "\nStrapi drops this content on boot. Add a new field and backfill it instead, or add" +
        "\nthe schema-break-ok label if losing the content is intended.",
    );
    process.exit(1);
  }
  console.log("No CMS schema change drops stored content.");
}
