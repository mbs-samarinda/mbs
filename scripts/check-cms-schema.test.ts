import assert from "node:assert/strict";
import { test } from "node:test";

import { findBreaks } from "./check-cms-schema.ts";

const file = "apps/cms/src/components/blocks/hero.json";
const hero = {
  attributes: {
    title: { type: "string" },
    href: { type: "string", regex: "^/.*$" },
  },
};
const check = (head: Map<string, typeof hero>) => findBreaks(new Map([[file, hero]]), head);

test("a removed field breaks", () => {
  const head = { attributes: { title: { type: "string" } } };
  assert.deepEqual(check(new Map([[file, head]])), [
    { file, field: "href", from: "string", to: null },
  ]);
});

test("a changed type breaks", () => {
  const head = { attributes: { ...hero.attributes, title: { type: "text" } } };
  assert.deepEqual(check(new Map([[file, head]])), [
    { file, field: "title", from: "string", to: "text" },
  ]);
});

test("a deleted file breaks every field in it", () => {
  assert.deepEqual(
    check(new Map()).map((b) => b.field),
    ["title", "href"],
  );
});

test("an added field passes", () => {
  const head = { attributes: { ...hero.attributes, subtitle: { type: "string" } } };
  assert.deepEqual(check(new Map([[file, head]])), []);
});

test("a regex change passes", () => {
  const head = { attributes: { ...hero.attributes, href: { type: "string", regex: "^.*$" } } };
  assert.deepEqual(check(new Map([[file, head]])), []);
});
