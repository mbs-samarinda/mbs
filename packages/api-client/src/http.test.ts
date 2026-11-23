import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, authPost, fetchAccount, goToGoogle } from "./auth.ts";
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
    await expect(authPost("/sign-in/email-otp", {})).rejects.toMatchObject({
      status: 400,
      code: "INVALID_OTP",
      retryAfterSeconds: null,
    });

    fetchMock.mockResolvedValueOnce(
      fromApi({ message: "Too many requests." }, 429, { "x-retry-after": "42" }),
    );
    const error = await authPost("/sign-in/social", {}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 429, code: null, retryAfterSeconds: 42 });
  });

  it("does not read a cut-off answer as no account", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"user":{"em', { headers: { "x-request-id": "1" } }),
    );
    await expect(fetchAccount()).rejects.toBeInstanceOf(UnreachableError);
  });

  it("takes a sign-in whose answer is cut off as done", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"us', { headers: { "x-request-id": "1" } }));
    await expect(authPost("/sign-in/email-otp", {})).resolves.toBeUndefined();
  });

  it("goes to Google, and gives the button back when the page never leaves", async () => {
    vi.useFakeTimers();
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "http://localhost:5173", assign });
    fetchMock.mockResolvedValueOnce(fromApi({ url: "https://accounts.google.test/" }));
    let settled = false;
    const going = goToGoogle({ returnTo: "/", errorTo: "/masuk", chooseAccount: false }).then(
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(assign).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/");
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await going;
    vi.useRealTimers();
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
