import { SCHOOLS } from "@mbs/school-config";
import { expect, test } from "@playwright/test";

// One app answers four hostnames. The unit tests of `proxy.ts` and `owners.ts`
// prove the routing decisions; these prove the result, through a production
// build and the seeded CMS: each host renders its own site, and every page a
// school's menu links to renders at all. The build prerenders nothing, so
// before this, no page ran ahead of the deploy's smoke check.

/** The base URL with another owner's host, which is how the app tells sites apart. */
const at = (baseURL: string | undefined, host: string, path = "/") => {
  const url = new URL(path, baseURL);
  url.hostname = host;
  return url.href;
};

// The umbrella is named in `owners.ts`, which Playwright cannot load (its
// `next/navigation` import only resolves inside Next), so its name is typed here.
const owners = [
  { host: "localhost", name: "Madina Boarding School" },
  ...SCHOOLS.map((school) => ({ host: `${school.subdomain}.localhost`, name: school.name })),
];

for (const { host, name } of owners) {
  test(`${host} serves ${name}`, async ({ page, baseURL }) => {
    const response = await page.goto(at(baseURL, host));
    expect(response?.status()).toBe(200);
    // The home's title is the owner's name alone, so another owner's site
    // here fails this exactly.
    await expect(page).toHaveTitle(name);
  });
}

test("a school-only path on the apex is its branded 404", async ({ page, baseURL }) => {
  const response = await page.goto(at(baseURL, "localhost", "/profil"));
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Halaman tidak ditemukan");
  await expect(
    page.getByRole("heading", { name: "Halaman ini tidak ada di situs Madina Boarding School" }),
  ).toBeVisible();
});

// The phone menu, not the desktop header: its groups are native <details>, so
// every link, grouped ones included, is in the page once the menu opens. The
// desktop groups are popovers whose links exist only while open.
// SMP only: the three schools share every route, and each page renders on its
// first request, so one school keeps the run short.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("every page in a school's menu renders", async ({ page }) => {
    test.slow();
    await page.goto("/");
    const menu = page.getByRole("navigation", { name: "Halaman" });
    // A tap before the page hydrates does nothing, and the list only exists
    // while the sheet is open, so tap until it opens.
    await expect(async () => {
      await page.getByRole("button", { name: "Menu" }).click({ timeout: 1000 });
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass();
    const hrefs = await menu
      .locator("a")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);
    // An editor can link anywhere; only this site's own pages are under test.
    const pages = hrefs.filter((href) => href.startsWith("/"));
    expect(pages).toContain("/artikel");

    for (const href of pages) {
      // One page, so one visit at a time.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await page.goto(href);
      expect(response?.status(), href).toBe(200);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await expect(page.getByRole("heading", { level: 1 }), href).toBeVisible();
    }
  });
});
