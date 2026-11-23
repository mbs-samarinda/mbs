import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { setPendingEmail } from "../email-code.ts";
import { createAppRouter, createQueryClient } from "../router.tsx";

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Answers each auth path in turn; the last answer repeats. */
function stubApi(answers: Record<string, Answer[]>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const path = input.replace("/api/auth", "");
    calls.push({ path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const queue = answers[path];
    const answer = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (!answer) throw new TypeError("Failed to fetch");
    return Response.json(answer.body ?? null, {
      status: answer.status ?? 200,
      headers: { "x-request-id": "1", ...answer.headers },
    });
  });
  return calls;
}

function open(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const SIGNED_OUT = { "/get-session": [{ body: null }] };

async function openCodeStep(path = "/masuk/kode") {
  setPendingEmail("wali@example.test");
  const router = open(path);
  const code = await screen.findByLabelText("Kode 6 angka");
  return { router, code };
}

describe("the code step", () => {
  it("shows a wrong code's error under the code field, and lets the next digit start over", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/sign-in/email-otp": [{ status: 400, body: { code: "INVALID_OTP" } }],
    });
    const { code } = await openCodeStep();
    const user = userEvent.setup();
    await user.type(code, "482918");

    const alert = await screen.findByText(/Kode belum cocok/);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code.getAttribute("aria-describedby")?.split(" ")).toContain(alert.closest("[id]")?.id);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(code.compareDocumentPosition(alert)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const resend = screen.getByRole("button", { name: "Kirim kode baru" });
    expect(alert.compareDocumentPosition(resend)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(code).toHaveValue("482918");
  });

  it("submits a pasted code once, spaces and all, then opens the page that was asked for", async () => {
    const calls = stubApi({ ...SIGNED_OUT, "/sign-in/email-otp": [{ body: { user: {} } }] });
    const { router, code } = await openCodeStep("/masuk/kode?lanjut=%2F%3Fdari%3Dprofil");
    const user = userEvent.setup();
    await user.click(code);
    await user.paste("482 918");

    await waitFor(() => expect(router.state.location.href).toBe("/?dari=profil"));
    expect(await screen.findByText("wali@example.test")).toBeVisible();
    expect(calls.filter((call) => call.path === "/sign-in/email-otp")).toEqual([
      { path: "/sign-in/email-otp", body: { email: "wali@example.test", otp: "482918" } },
    ]);
  });

  it("sends a right code pasted over a wrong one", async () => {
    const calls = stubApi({
      ...SIGNED_OUT,
      "/sign-in/email-otp": [
        { status: 400, body: { code: "INVALID_OTP" } },
        { body: { user: {} } },
      ],
    });
    const { router, code } = await openCodeStep();
    const user = userEvent.setup();
    await user.type(code, "111111");
    await screen.findByText(/Kode belum cocok/);
    await user.paste("482918");

    await waitFor(() => expect(router.state.location.href).toBe("/"));
    expect(calls.filter((call) => call.path === "/sign-in/email-otp").at(-1)?.body).toEqual({
      email: "wali@example.test",
      otp: "482918",
    });
  });

  it("never sends a refused code again when asking for a new one fails", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/sign-in/email-otp": [{ status: 400, body: { code: "INVALID_OTP" } }],
    });
    const { code } = await openCodeStep();
    const user = userEvent.setup();
    await user.type(code, "111111");
    await screen.findByText(/Kode belum cocok/);
    await user.click(screen.getByRole("button", { name: "Kirim kode baru" }));
    expect(await screen.findByText(/Server tidak bisa dihubungi/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  it.each([
    ["an expired code", { status: 400, body: { code: "OTP_EXPIRED" } }, /lewat 5 menit/],
    ["too many tries", { status: 403, body: { code: "TOO_MANY_ATTEMPTS" } }, /3 kali tidak cocok/],
    ["the rate limit", { status: 429, headers: { "x-retry-after": "42" } }, /Tunggu 42 detik/],
    ["a server fault", { status: 500, body: {} }, /Ada gangguan/],
  ])("explains %s", async (_, answer, message) => {
    stubApi({ ...SIGNED_OUT, "/sign-in/email-otp": [answer] });
    const { code } = await openCodeStep();
    await userEvent.setup().type(code, "482918");
    expect(await screen.findByText(message)).toBeVisible();
  });

  it("keeps the code when the server cannot be reached, and sends it again", async () => {
    const calls = stubApi(SIGNED_OUT);
    const { code } = await openCodeStep();
    const user = userEvent.setup();
    await user.type(code, "482918");
    await user.click(await screen.findByRole("button", { name: "Coba lagi" }));

    expect(await screen.findByText(/Server tidak bisa dihubungi/)).toBeVisible();
    expect(code).toHaveValue("482918");
    expect(code).not.toHaveAttribute("aria-invalid");
    expect(calls.filter((call) => call.path === "/sign-in/email-otp")).toHaveLength(2);
  });

  it("says when a new code was sent, and clears the old one", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/sign-in/email-otp": [{ status: 400, body: { code: "INVALID_OTP" } }],
      "/email-otp/send-verification-otp": [{ body: { success: true } }],
    });
    const { code } = await openCodeStep();
    const user = userEvent.setup();
    await user.type(code, "482918");
    await screen.findByText(/Kode belum cocok/);
    await user.click(screen.getByRole("button", { name: "Kirim kode baru" }));

    expect(await screen.findByText("Kode baru sudah dikirim.")).toBeVisible();
    expect(screen.queryByText(/Kode belum cocok/)).toBeNull();
    expect(code).toHaveValue("");
    expect(code).toHaveFocus();
  });

  it("starts at the email when no code was asked for", async () => {
    stubApi(SIGNED_OUT);
    const router = open("/masuk/kode?lanjut=%2F%3Fdari%3Dprofil");
    expect(await screen.findByLabelText("Alamat email")).toBeVisible();
    expect(router.state.location.href).toBe("/masuk?lanjut=%2F%3Fdari%3Dprofil");
  });
});

describe("the email step", () => {
  it("asks for a code once on a double press, and keeps the address for the next step", async () => {
    const calls = stubApi({
      ...SIGNED_OUT,
      "/email-otp/send-verification-otp": [{ body: { success: true } }],
    });
    const router = open("/masuk");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Alamat email"), " wali@example.test ");
    await user.dblClick(screen.getByRole("button", { name: "Kirim kode masuk" }));

    expect(await screen.findByRole("heading", { name: "Periksa email kamu" })).toBeVisible();
    expect(router.state.location.href).toBe("/masuk/kode");
    expect(screen.getByText("wali@example.test")).toBeVisible();
    expect(calls.filter((call) => call.path === "/email-otp/send-verification-otp")).toEqual([
      {
        path: "/email-otp/send-verification-otp",
        body: { email: "wali@example.test", type: "sign-in" },
      },
    ]);
  });

  it("explains an address the server refuses, under the field, and puts focus back", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/email-otp/send-verification-otp": [{ status: 400, body: { code: "INVALID_EMAIL" } }],
    });
    open("/masuk");
    const email = await screen.findByLabelText("Alamat email");
    const user = userEvent.setup();
    await user.type(email, "wali@{Enter}");
    expect(await screen.findByText(/Tulis alamat email lengkap/)).toBeVisible();
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("leads to the last code when no more will be sent", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/email-otp/send-verification-otp": [
        {
          status: 429,
          body: { code: "TOO_MANY_CODES", lastCodeInTime: true },
          headers: { "x-retry-after": "640" },
        },
      ],
    });
    open("/masuk");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Alamat email"), "wali@example.test{Enter}");
    expect(await screen.findByText(/minta kode baru 11 menit lagi/)).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Masukkan kode terakhir" }));
    expect(await screen.findByLabelText("Kode 6 angka")).toBeVisible();
    expect(screen.getByText("wali@example.test")).toBeVisible();
  });

  it("does not offer the last code once it is too old", async () => {
    stubApi({
      ...SIGNED_OUT,
      "/email-otp/send-verification-otp": [
        {
          status: 429,
          body: { code: "TOO_MANY_CODES", lastCodeInTime: false },
          headers: { "x-retry-after": "300" },
        },
      ],
    });
    open("/masuk");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Alamat email"), "wali@example.test{Enter}");
    expect(await screen.findByText(/Minta kode baru 5 menit lagi/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Masukkan kode terakhir" })).toBeNull();
  });

  it("sends the safe page and the sign-in page to Google", async () => {
    const calls = stubApi({
      ...SIGNED_OUT,
      "/sign-in/social": [{ status: 429, headers: { "x-retry-after": "8" } }],
    });
    open("/masuk?lanjut=%2F%3Fdari%3Dprofil");
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Lanjutkan dengan Google" }));
    expect(await screen.findByText(/Tunggu 8 detik/)).toBeVisible();
    expect(calls.find((call) => call.path === "/sign-in/social")?.body).toEqual({
      provider: "google",
      callbackURL: `${location.origin}/?dari=profil`,
      errorCallbackURL: `${location.origin}/masuk?lanjut=%2F%3Fdari%3Dprofil`,
    });
  });
});

describe("the guard", () => {
  it.each([
    ["/", "/masuk"],
    ["/?dari=profil#syarat", "/masuk?lanjut=%2F%3Fdari%3Dprofil%23syarat"],
    ["/?error=access_denied", "/masuk?error=access_denied"],
  ])("sends a signed-out visit to %s to %s", async (from, to) => {
    stubApi(SIGNED_OUT);
    const router = open(from);
    await screen.findByLabelText("Alamat email");
    expect(router.state.location.href).toBe(to);
  });

  it("drops a return page on another site", async () => {
    stubApi({ "/get-session": [{ body: { user: { email: "wali@example.test" } } }] });
    const router = open("/masuk?lanjut=https%3A%2F%2Fevil.test");
    await waitFor(() => expect(router.state.location.href).toBe("/"));
  });

  it("says the server cannot be reached, and loads once it can", async () => {
    stubApi({});
    open("/");
    expect(
      await screen.findByRole("heading", { name: "Server tidak bisa dihubungi" }),
    ).toBeVisible();
    stubApi({ "/get-session": [{ body: { user: { email: "wali@example.test" } } }] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Belum ada pendaftaran")).toBeVisible();
  });

  it("signs out to the sign-in screen", async () => {
    stubApi({
      "/get-session": [{ body: { user: { email: "wali@example.test" } } }, { body: null }],
      "/sign-out": [{ body: { success: true } }],
    });
    const router = open("/");
    const header = within(await screen.findByRole("banner"));
    await userEvent.setup().click(header.getByRole("button", { name: "Keluar" }));
    expect(await screen.findByLabelText("Alamat email")).toBeVisible();
    expect(router.state.location.href).toBe("/masuk");
  });
});

it("answers an unknown page with a way back", async () => {
  stubApi(SIGNED_OUT);
  open("/tidak-ada");
  expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Buka halaman utama" })).toHaveAttribute("href", "/");
});
