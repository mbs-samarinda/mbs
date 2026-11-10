import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SECRET = "a-secret-of-at-least-16";

/** The route reads its secret when `config/env.ts` loads, so each case imports it fresh. */
async function post(secret: string | undefined, header?: string) {
  vi.resetModules();
  vi.stubEnv("REVALIDATE_SECRET", secret ?? "");
  const { POST } = await import("./route.ts");
  const { revalidateTag } = await import("next/cache");
  const headers: Record<string, string> =
    header === undefined ? {} : { "x-revalidate-secret": header };
  const response = await POST(
    new Request("http://localhost/api/revalidate", { method: "POST", headers }),
  );
  return { status: response.status, revalidated: vi.mocked(revalidateTag).mock.calls.length > 0 };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("an unset secret refuses every request rather than leaving the cache open", async () => {
  expect(await post(undefined, "anything")).toEqual({ status: 503, revalidated: false });
});

test("a wrong secret of any length, or none, is a 401", async () => {
  expect(await post(SECRET, "short")).toEqual({ status: 401, revalidated: false });
  expect(await post(SECRET, `${SECRET}x`)).toEqual({ status: 401, revalidated: false });
  expect(await post(SECRET)).toEqual({ status: 401, revalidated: false });
});

test("the right secret drops the content cache", async () => {
  expect(await post(SECRET, SECRET)).toEqual({ status: 200, revalidated: true });
});
