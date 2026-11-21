import { expect, test } from "vitest";

import { ownerByKey } from "./owners.ts";
import { shareImage, shareMetadata } from "./share.ts";

const smp = ownerByKey("smp");
const photo = { url: "/uploads/a.jpg", alternativeText: "Lapangan", width: 3000, height: 2000 };

test("an empty description leaves the key out, so the layout's tagline survives", () => {
  expect(shareMetadata(smp, "profil", { description: null })).not.toHaveProperty("description");
  expect(shareMetadata(smp, "profil")).not.toHaveProperty("description");
  expect(shareMetadata(smp, "profil", { description: "Isi" }).description).toBe("Isi");
});

test("every page carries the site name, locale and its own address", () => {
  const meta = shareMetadata(smp, "artikel/berita/a", { publishedTime: "2026-11-01" });
  expect(meta.alternates?.canonical).toBe("/artikel/berita/a");
  expect(meta.openGraph).toMatchObject({
    siteName: smp.name,
    locale: "id_ID",
    url: "/artikel/berita/a",
    type: "article",
    publishedTime: "2026-11-01",
  });
  expect(shareMetadata(smp, "").openGraph).toMatchObject({ url: "/", type: "website" });
});

test("a share image is a preview-sized copy with its real proportions", () => {
  const image = shareImage(photo);
  expect(image.url).toMatch(/^\/_next\/image\?url=.*a\.jpg&w=1200&q=75$/);
  expect(image).toMatchObject({ width: 1200, height: 800, alt: "Lapangan" });
  // The optimizer never enlarges, so a small photo keeps its own size.
  expect(shareImage({ ...photo, width: 800, height: 600 })).toMatchObject({
    width: 800,
    height: 600,
  });
});

test("an SVG or a file of unknown width goes out as uploaded", () => {
  const svg = shareImage({ ...photo, url: "/uploads/logo.svg" });
  expect(svg.url).toMatch(/^https?:\/\/[^/]+\/uploads\/logo\.svg$/);
  expect(svg).not.toHaveProperty("width");
  expect(shareImage({ ...photo, width: 0 })).not.toHaveProperty("height");
});

test("a page without a photo shares its owner's own card", () => {
  expect(shareMetadata(smp, "profil").openGraph?.images).toEqual([
    { url: "/og.png", width: 1200, height: 630, alt: smp.name },
  ]);
});
