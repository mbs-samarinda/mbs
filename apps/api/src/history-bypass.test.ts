import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `correct_history` is for a person at a psql prompt. Code that calls it would
 * turn the one audited bypass into a routine path, so only the migration that
 * defines it and test code may name it.
 */
const ROOT = join(import.meta.dirname, "../../..");
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", ".strapi"]);
const SOURCE = /\.(ts|tsx|js|mjs|cjs|sql)$/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (SOURCE.test(entry.name)) {
      yield relative(ROOT, join(dir, entry.name));
    }
  }
}

function isAllowed(path: string) {
  return (
    path.startsWith("packages/db/drizzle/") || path.includes("/test/") || /\.test\.tsx?$/.test(path)
  );
}

describe("correct_history", () => {
  const mentions = ["apps", "packages"]
    .flatMap((dir) => [...sourceFiles(join(ROOT, dir))])
    .filter((path) => readFileSync(join(ROOT, path), "utf8").includes("correct_history"));

  // Without this, a scan that found no files at all would pass.
  it("is found where it is defined", () => {
    expect(mentions).toContain("packages/db/drizzle/0008_history_guard.sql");
  });

  it("is called by no application code", () => {
    expect(mentions.filter((path) => !isAllowed(path))).toEqual([]);
  });
});
