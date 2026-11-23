import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, authRequest, fetchAccount } from "./auth.ts";
import { UnreachableError } from "./http.ts";
import { createApiClient } from "./rpc.ts";

vi.stubGlobal("location", { origin: "http://localhost:5173" });

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

const fromApi = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "x-request-id": "1", ...headers } });

describe("calls to the API", () => {
  it("tells a dead API apart from a refusal", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchAccount()).rejects.toBeInstanceOf(UnreachableError);

    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    await expect(fetchAccount()).rejects.toBeInstanceOf(UnreachableError);

    fetchMock.mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }));
    await expect(fetchAccount()).rejects.toBeInstanceOf(UnreachableError);
  });

  it("carries the code and the wait of a refusal", async () => {
    fetchMock.mockResolvedValueOnce(fromApi({ code: "INVALID_OTP" }, 400));
    await expect(authRequest("/sign-in/email-otp", {})).rejects.toMatchObject({
      status: 400,
      code: "INVALID_OTP",
      retryAfterSeconds: null,
    });

    fetchMock.mockResolvedValueOnce(
      fromApi({ message: "Too many requests." }, 429, { "x-retry-after": "42" }),
    );
    const error = await authRequest("/sign-in/social", {}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 429, code: null, retryAfterSeconds: 42 });
  });

  it("reads the account, and no account", async () => {
    fetchMock.mockResolvedValueOnce(fromApi({ user: { email: "wali@example.test" }, session: {} }));
    expect(await fetchAccount()).toEqual({ email: "wali@example.test" });
    fetchMock.mockResolvedValueOnce(fromApi(null));
    expect(await fetchAccount()).toBeNull();
  });

  it("sends contract calls to the same origin", async () => {
    fetchMock.mockResolvedValueOnce(fromApi({ json: null }));
    await createApiClient().public.admission.getCurrentCycle({ schoolKey: "smp" });
    const [request] = fetchMock.mock.calls[0]!;
    expect(new Request(request).url).toMatch(
      /^http:\/\/localhost:5173\/api\/rpc\/public\/admission\/getCurrentCycle/,
    );

    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    await expect(createApiClient().staff.me.get()).rejects.toBeInstanceOf(UnreachableError);
  });
});
