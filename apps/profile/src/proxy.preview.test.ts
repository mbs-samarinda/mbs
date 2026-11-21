import { NextRequest } from "next/server";
import { beforeAll, expect, test, vi } from "vitest";

const SECRET = "a-preview-secret-of-at-least-32-chars";

// `config/env.ts` reads the environment when it loads, so the proxy is
// imported after the stubs.
let proxy: typeof import("./proxy.ts").proxy;
let preview: typeof import("./preview.ts");
beforeAll(async () => {
  vi.stubEnv("PREVIEW_SECRET", SECRET);
  vi.stubEnv("CMS_HOST", "cms.mbss.sch.id");
  ({ proxy } = await import("./proxy.ts"));
  preview = await import("./preview.ts");
});

const request = (host: string, cookies: Record<string, string>) =>
  new NextRequest(`http://${host}/`, {
    headers: {
      host,
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });

const csp = (response: Response) => response.headers.get("content-security-policy") ?? "";

/** The cookie header the page will see, when the proxy replaced it. */
const forwardedCookie = (response: Response) => response.headers.get("x-middleware-request-cookie");

test("only the CMS may frame a page", () => {
  const response = proxy(request("smp.mbss.sch.id", {}));
  expect(csp(response)).toContain("frame-ancestors cms.mbss.sch.id;");
});

test("a preview on its own school keeps Draft Mode", () => {
  const session = preview.sessionValue(SECRET, "smp", preview.nowS());
  const response = proxy(
    request("smp.mbss.sch.id", { [preview.DRAFT_COOKIE]: "x", [preview.PREVIEW_COOKIE]: session }),
  );
  expect(forwardedCookie(response)).toBeNull();
});

test("a Draft Mode cookie carried to another school is dropped before the page", () => {
  const session = preview.sessionValue(SECRET, "smp", preview.nowS());
  for (const cookies of [
    { [preview.DRAFT_COOKIE]: "x", [preview.PREVIEW_COOKIE]: session },
    { [preview.DRAFT_COOKIE]: "x" },
  ]) {
    const response = proxy(request("sma.mbss.sch.id", cookies));
    expect(forwardedCookie(response)).not.toBeNull();
    expect(forwardedCookie(response)).not.toContain(preview.DRAFT_COOKIE);
    expect(response.headers.get("set-cookie")).toContain(`${preview.DRAFT_COOKIE}=;`);
  }
});
