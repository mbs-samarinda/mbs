import { expect, test } from "vitest";

import { toMenu } from "./nav-link.ts";

const artikel = [
  { label: "Berita", href: "/artikel/berita" },
  { label: "Opini", href: "/artikel/opini" },
];

test("a group keeps its own address as the overview, even when the editor removed that child", () => {
  expect(
    toMenu([
      { label: "Beranda", href: "/", links: [] },
      {
        label: "Artikel",
        href: "/artikel",
        links: [{ label: "Semua artikel", href: "/artikel" }, ...artikel],
      },
      { label: "Lain", href: "/lain", links: artikel },
      { label: "Kosong", href: null, links: [] },
    ]),
  ).toEqual([
    { label: "Beranda", href: "/" },
    { label: "Artikel", overview: { label: "Semua artikel", href: "/artikel" }, links: artikel },
    { label: "Lain", overview: { label: "Lain", href: "/lain" }, links: artikel },
  ]);
});
