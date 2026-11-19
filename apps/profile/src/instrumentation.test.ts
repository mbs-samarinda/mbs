import { expect, test, vi } from "vitest";

import { onRequestError } from "./instrumentation.ts";

const lines = (...calls: [error: unknown, path?: string][]) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const [error, path] of calls) void report(error, path);
  const logged = log.mock.calls.map(([line]) => JSON.parse(String(line)));
  log.mockRestore();
  return logged;
};

const report = (error: unknown, path = "/profil?nik=123") =>
  onRequestError(
    error,
    { path, method: "GET", headers: { host: "sma.mbss.sch.id" } },
    {
      routerKind: "App Router",
      routePath: "/[owner]/profil",
      routeType: "render",
      renderSource: "server-rendering",
      revalidateReason: undefined,
    },
  );

test("one JSON line ties the digest to host and path, without the query", () => {
  const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
  const failed = Object.assign(new Error("CMS request for site failed", { cause: refused }), {
    digest: "477117628",
  });

  expect(lines([failed])).toMatchObject([
    {
      digest: "477117628",
      host: "sma.mbss.sch.id",
      path: "/profil",
      route: "/[owner]/profil",
      causes: ["Error ECONNREFUSED"],
    },
  ]);
});

test("a cause chain that loops back on itself still ends", () => {
  const loop = new Error("loop");
  loop.cause = loop;

  expect(lines([new Error("outer", { cause: loop })])[0].causes).toHaveLength(5);
});

test("one error is one line per page: repeats in a render drop, another page keeps its own", () => {
  const shared = new Error("CMS request for site failed");

  expect(
    lines([shared], [shared], [shared, "/artikel"], [new Error("CMS request for site failed")]).map(
      (line) => line.path,
    ),
  ).toEqual(["/profil", "/artikel", "/profil"]);
});
