import { expect, test } from "vitest";

import { ActivityRow } from "./entries.ts";

test("an activity from before the icon field existed gets the star", () => {
  expect(ActivityRow.parse({ slug: "pramuka", icon: null })).toMatchObject({
    icon: "bintang",
    images: [],
  });
});
