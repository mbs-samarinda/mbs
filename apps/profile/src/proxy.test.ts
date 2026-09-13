import { NextRequest } from "next/server";
import { expect, test } from "vitest";

import { proxy } from "./proxy.ts";

const request = (host: string, path = "/") =>
  new NextRequest(`http://${host}${path}`, { headers: { host } });

test("a known host rewrites to its owner segment", () => {
  const response = proxy(request("sma.mbss.sch.id", "/about?x=1"));
  expect(response.headers.get("x-middleware-rewrite")).toBe("http://sma.mbss.sch.id/sma/about?x=1");
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
