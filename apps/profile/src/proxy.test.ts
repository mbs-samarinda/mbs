import { NextRequest } from "next/server";
import { expect, test } from "vitest";

import { config, proxy } from "./proxy.ts";

const request = (host: string, path = "/") =>
  new NextRequest(`http://${host}${path}`, { headers: { host } });

test("a known host rewrites to its owner segment", () => {
  const response = proxy(request("sma.mbss.sch.id", "/about?x=1"));
  expect(response.headers.get("x-middleware-rewrite")).toBe("http://sma.mbss.sch.id/sma/about?x=1");
});

// Next applies the matcher outside this function, so the guard has to read
// the matcher itself: the favicon must go through the owner rewrite to reach
// its `public/<owner>/` file.
test("the matcher does not skip the favicon", () => {
  expect(config.matcher.join()).not.toContain("favicon");
});

test("www redirects permanently to the bare host, path kept", () => {
  const cases = [
    ["www.mbss.sch.id", "mbss.sch.id"],
    ["www.smk.mbss.sch.id", "smk.mbss.sch.id"],
  ] as const;
  for (const [host, bare] of cases) {
    const response = proxy(request(host, "/about?x=1"));
    expect(response.status, host).toBe(308);
    expect(response.headers.get("location"), host).toBe(`https://${bare}/about?x=1`);
  }
});

test("an unknown host is refused", () => {
  expect(proxy(request("sd.mbss.sch.id")).status).toBe(404);
});

// The apex has only its home, and the pages' own `notFound()` cannot produce
// the branded 404: with the root layout inside `[owner]` there is no not-found
// boundary in the tree, so Next renders its built-in page instead.
// `global-not-found.tsx` only answers a URL that matches no route, so the proxy
// has to send the apex to one.
test("every apex path but the home is rewritten to an unclaimed path", () => {
  const paths = ["/profil", "/kontak", "/artikel", "/artikel/berita/x", "/program", "/galeri/a"];
  for (const path of paths) {
    const response = proxy(request("mbss.sch.id", path));
    expect(response.headers.get("x-middleware-rewrite"), path).toBe(
      "http://mbss.sch.id/mbs/__not-found",
    );
  }
});

test("the apex keeps its home and its favicon", () => {
  for (const [path, rewrite] of [
    ["/", "http://mbss.sch.id/mbs"],
    ["/favicon.ico", "http://mbss.sch.id/mbs/favicon.ico"],
  ] as const) {
    const response = proxy(request("mbss.sch.id", path));
    expect(response.headers.get("x-middleware-rewrite"), path).toBe(rewrite);
  }
});

test("the apex sends its admission path to the admission app", () => {
  const response = proxy(request("mbss.sch.id", "/pendaftaran?utm_source=ig"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://admission.mbss.sch.id/?utm_source=ig");
});

test("a school keeps every path", () => {
  for (const path of ["/ekstrakurikuler/panahan", "/pendaftaran"]) {
    const response = proxy(request("smk.mbss.sch.id", path));
    expect(response.headers.get("x-middleware-rewrite"), path).toBe(
      `http://smk.mbss.sch.id/smk${path}`,
    );
  }
});
