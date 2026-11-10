import assert from "node:assert/strict";
import { test } from "node:test";

import { findBreaks, type Schema } from "./check-cms-schema.ts";

const file = "apps/cms/src/api/page/content-types/page/schema.json";
const page: Schema = {
  collectionName: "pages",
  attributes: {
    title: { type: "string" },
    href: { type: "string", regex: "^/.*$" },
    seo: { type: "component", component: "shared.seo" },
    author: { type: "relation", relation: "oneToOne", target: "api::staff.staff" },
    blocks: { type: "dynamiczone", components: ["blocks.hero", "blocks.faq"] },
  },
};
const check = (head: Schema | undefined) =>
  findBreaks(new Map([[file, page]]), new Map(head ? [[file, head]] : [])).map(
    ({ field, reason }) => ({ field, reason }),
  );
const edit = (attributes: Schema["attributes"], collectionName = page.collectionName) => ({
  collectionName,
  attributes: { ...page.attributes, ...attributes },
});

test("a removed field breaks", () => {
  const attributes = Object.fromEntries(
    Object.entries(page.attributes).filter(([k]) => k !== "href"),
  );
  assert.deepEqual(check({ ...page, attributes }), [{ field: "href", reason: "removed" }]);
});

test("a changed type breaks", () => {
  assert.deepEqual(check(edit({ title: { type: "text" } })), [
    { field: "title", reason: "retyped" },
  ]);
});

test("a component field pointed elsewhere breaks", () => {
  assert.deepEqual(check(edit({ seo: { type: "component", component: "shared.meta" } })), [
    { field: "seo", reason: "retargeted" },
  ]);
});

test("a relation changed to another kind breaks", () => {
  const author = { type: "relation", relation: "manyToMany", target: "api::staff.staff" };
  assert.deepEqual(check(edit({ author })), [{ field: "author", reason: "retargeted" }]);
});

test("a relation handed to the other side breaks", () => {
  const author = {
    type: "relation",
    relation: "oneToOne",
    target: "api::staff.staff",
    mappedBy: "page",
  };
  assert.deepEqual(check(edit({ author })), [{ field: "author", reason: "retargeted" }]);
});

test("a component taken out of a dynamic zone breaks", () => {
  assert.deepEqual(check(edit({ blocks: { type: "dynamiczone", components: ["blocks.faq"] } })), [
    { field: "blocks", reason: "zone-shrunk" },
  ]);
});

test("a new collectionName breaks", () => {
  assert.deepEqual(check(edit({}, "halaman")), [
    { field: "collectionName", reason: "table-renamed" },
  ]);
});

test("a deleted file breaks every field in it", () => {
  assert.deepEqual(
    check(undefined).map((b) => b.field),
    ["title", "href", "seo", "author", "blocks"],
  );
});

test("an added field passes", () => {
  assert.deepEqual(check(edit({ subtitle: { type: "string" } })), []);
});

test("a regex change passes", () => {
  assert.deepEqual(check(edit({ href: { type: "string", regex: "^.*$" } })), []);
});

test("a component added to a dynamic zone passes", () => {
  const components = ["blocks.hero", "blocks.faq", "blocks.cta"];
  assert.deepEqual(check(edit({ blocks: { type: "dynamiczone", components } })), []);
});
