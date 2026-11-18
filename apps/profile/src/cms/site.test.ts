import { expect, test } from "vitest";

import { SiteRow } from "./site.ts";

test("a site row with every list missing or broken still parses, with empty lists", () => {
  const site = SiteRow.parse({
    tagline: "Kampus",
    menu: [{ label: "Profil" }, "not a row", null],
    footerColumns: "oops",
    socials: null,
  });

  expect(site).toMatchObject({
    tagline: "Kampus",
    menu: [{ label: "Profil", links: [] }],
    footerColumns: [],
    contacts: [],
    socials: [],
  });
});
