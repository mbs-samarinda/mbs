import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createAppRouter, createQueryClient } from "../router.tsx";

const ME = "/api/rpc/staff/me/get";
const ACCOUNT = "/api/auth/get-session";

type Answer = { status: number; body: unknown };
const rpc = (status: number, code: string): Answer => ({
  status,
  body: { json: { defined: false, code, status, message: code } },
});
const SIGNED_OUT: Answer = { status: 200, body: null };
const SIGNED_IN: Answer = { status: 200, body: { user: { email: "wali@example.test" } } };
const STAFF: Answer = {
  status: 200,
  body: { json: { id: "1", name: "Siti Rahmah", role: "STAFF", schoolKeys: ["smp"] } },
};

function stubApi(answers: Record<string, Answer>) {
  vi.stubGlobal("fetch", async (input: string | Request) => {
    const url = new URL(input instanceof Request ? input.url : input, location.origin);
    const answer = answers[url.pathname];
    if (!answer) throw new TypeError("Failed to fetch");
    return Response.json(answer.body, {
      status: answer.status,
      headers: { "x-request-id": "1" },
    });
  });
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

describe("the committee app", () => {
  it("sends a signed-out visit to sign-in, and back to the same page", async () => {
    stubApi({ [ACCOUNT]: SIGNED_OUT });
    const router = open("/?tahap=berkas");
    expect(await screen.findByRole("button", { name: "Masuk dengan Google" })).toBeVisible();
    expect(router.state.location.href).toBe("/masuk?lanjut=%2F%3Ftahap%3Dberkas");
  });

  it("says why Google was refused", async () => {
    stubApi({ [ACCOUNT]: SIGNED_OUT });
    open("/masuk?error=account_not_approved");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Akun Google itu belum punya akses. Pilih akun lain, atau minta administrator mendaftarkan email kamu.",
    );
    expect(screen.getByRole("button", { name: "Pilih akun Google lain" })).toBeVisible();
  });

  it("opens the dashboard with the staff name", async () => {
    stubApi({ [ACCOUNT]: SIGNED_IN, [ME]: STAFF });
    const router = open("/masuk?lanjut=https%3A%2F%2Fevil.test");
    expect(await screen.findByRole("heading", { name: "Dasbor" })).toBeVisible();
    expect(screen.getByText("Siti Rahmah")).toBeVisible();
    expect(router.state.location.href).toBe("/");
  });

  it("refuses a signed-in account that is not active staff, with a way out", async () => {
    stubApi({
      [ME]: rpc(403, "FORBIDDEN"),
      [ACCOUNT]: SIGNED_IN,
      "/api/auth/sign-out": { status: 200, body: { success: true } },
    });
    open("/");
    expect(
      await screen.findByRole("heading", { name: "Akun ini belum punya akses" }),
    ).toBeVisible();
    expect(screen.getByText(/wali@example.test/)).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Keluar" }));
    expect(await screen.findByRole("button", { name: "Masuk dengan Google" })).toBeVisible();
  });

  it("says the server cannot be reached, and loads once it can", async () => {
    stubApi({});
    open("/");
    expect(
      await screen.findByRole(
        "heading",
        { name: "Server tidak bisa dihubungi" },
        { timeout: 5000 },
      ),
    ).toBeVisible();
    stubApi({ [ACCOUNT]: SIGNED_IN, [ME]: STAFF });
    await userEvent.setup().click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("heading", { name: "Dasbor" })).toBeVisible();
  }, 10_000);

  it("answers an unknown page with a way back", async () => {
    stubApi({ [ACCOUNT]: SIGNED_OUT });
    open("/tidak-ada");
    expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  });
});
