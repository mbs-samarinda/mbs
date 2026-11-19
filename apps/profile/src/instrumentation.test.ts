import { expect, test, vi } from "vitest";

import { onRequestError } from "./instrumentation.ts";

const report = (error: unknown) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  void onRequestError(
    error,
    { path: "/profil?nik=123", method: "GET", headers: { host: "sma.mbss.sch.id" } },
    {
      routerKind: "App Router",
      routePath: "/[owner]/profil",
      routeType: "render",
      renderSource: "server-rendering",
      revalidateReason: undefined,
    },
  );
  const line = String(log.mock.calls[0]?.[0]);
  log.mockRestore();
  return JSON.parse(line);
};

test("one JSON line ties the digest to host and path, without the query", () => {
  const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
  const failed = Object.assign(new Error("CMS request for site failed", { cause: refused }), {
    digest: "477117628",
  });

  expect(report(failed)).toMatchObject({
    digest: "477117628",
    host: "sma.mbss.sch.id",
    path: "/profil",
    route: "/[owner]/profil",
    causes: ["Error ECONNREFUSED"],
  });
});

test("a cause chain that loops back on itself still ends", () => {
  const loop = new Error("loop");
  loop.cause = loop;

  expect(report(new Error("outer", { cause: loop })).causes).toHaveLength(5);
});
