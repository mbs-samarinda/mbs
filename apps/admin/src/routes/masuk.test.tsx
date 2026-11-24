import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT,
  DASHBOARD,
  EMPTY_DASHBOARD,
  ME,
  ok,
  open,
  rpc,
  SIGNED_IN,
  SIGNED_OUT,
  STAFF,
  stubApi,
} from "../../test/app.tsx";

const SIGNED_IN_STAFF = { [ACCOUNT]: SIGNED_IN, [ME]: STAFF, [DASHBOARD]: ok(EMPTY_DASHBOARD) };

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

  it("opens Beranda with the staff name", async () => {
    stubApi(SIGNED_IN_STAFF);
    const router = open("/masuk?lanjut=https%3A%2F%2Fevil.test");
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeVisible();
    expect(screen.getAllByText("Siti Rahmah")[0]).toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "Server tidak bisa dihubungi" }),
    ).toBeVisible();
    stubApi(SIGNED_IN_STAFF);
    await userEvent.setup().click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeVisible();
  });

  it("answers an unknown page with a way back", async () => {
    stubApi({ [ACCOUNT]: SIGNED_OUT });
    open("/tidak-ada");
    expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  });
});
