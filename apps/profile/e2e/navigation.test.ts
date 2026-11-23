import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

// A `<Link>` click must show the destination's shell at once, from what was
// fetched ahead of the click: header, page head and placeholders. Inside
// `instant()` Next holds back everything else until the callback ends.
//
// The four detail pages export `instant = false` and block on purpose, so they
// are not here (see `artikel/[type]/[slug]/page.tsx`).
//
// Content is the CMS seed for SMP, the base URL's site.
const cases = [
  {
    path: "/profil",
    from: "/",
    link: { name: "Halaman", text: "Profil" },
    heading: "Profil SMP Islam Terpadu Madina",
    // The admission band's live facts. No API runs here, so they settle on
    // "unavailable", whose line only shows once the facts arrive.
    heldBack: "Perlu jawaban sekarang?",
  },
  {
    path: "/artikel",
    from: "/",
    link: { name: "Informasi", text: "Semua artikel" },
    heading: "Artikel",
    // A seeded news article (news never expires): the listing streams in after
    // the shell.
    heldBack: "Karya ilmiah santri masuk babak akhir lomba kota",
  },
];

for (const { path, from, link, heading, heldBack } of cases) {
  test(`${from} to ${path} is instant`, async ({ page }) => {
    await page.goto(from);

    const target = page
      .getByRole("navigation", { name: link.name })
      .getByRole("link", { name: link.text, exact: true });
    // Until React attaches, a click is a plain page load, which the hold does
    // not cover. React's props key is the only sign of it in the DOM.
    await expect
      .poll(() =>
        target.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))),
      )
      .toBe(true);

    await instant(page, async () => {
      await target.click();
      // A page that waits on the server never commits while held, so this is
      // the check that fails. Bounded, or it eats the whole test timeout and
      // the report blames the cookie cleanup instead.
      await page.waitForURL((url) => url.pathname === path, { timeout: 5_000 });
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // Proves the hold is on. A build without the testing API ignores
      // `instant()`, and the shell checks above still pass because they beat
      // the stream. The wait gives that stream time to land; held, it never does.
      await page.waitForTimeout(1_000);
      await expect(page.getByRole("main").getByText(heldBack)).toHaveCount(0);
    });

    await expect(page.getByRole("main").getByText(heldBack).first()).toBeVisible();
  });
}
