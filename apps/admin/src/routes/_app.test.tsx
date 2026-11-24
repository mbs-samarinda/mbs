import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT,
  DASHBOARD,
  EMPTY_DASHBOARD,
  LIST,
  ME,
  ok,
  open,
  rpc,
  SIGNED_IN,
  STAFF,
  stubApi,
} from "../../test/app.tsx";

const SIGNED_IN_STAFF = { [ACCOUNT]: SIGNED_IN, [ME]: STAFF };

describe("Beranda", () => {
  it("says each number in words when the cycle is empty, never NaN or null", async () => {
    stubApi({ ...SIGNED_IN_STAFF, [DASHBOARD]: ok(EMPTY_DASHBOARD) });
    open("/");
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeVisible();

    for (const sentence of [
      "Belum ada minggu ini",
      "Belum ada pendaftar",
      "Tidak ada antrean",
      "Belum ada yang diputuskan",
      "Belum ada aktivitas.",
    ]) {
      expect(screen.getByText(sentence)).toBeVisible();
    }
    expect(document.body).not.toHaveTextContent(/NaN|null|undefined|Infinity/);
  });

  it("rounds the paid share down and names the cycle", async () => {
    stubApi({
      ...SIGNED_IN_STAFF,
      [DASHBOARD]: ok({
        ...EMPTY_DASHBOARD,
        total: 2500,
        paid: 2499,
        perSchool: [{ schoolKey: "smp", total: 2500 }],
      }),
    });
    open("/");
    expect(await screen.findByText("99% dari pendaftar")).toBeVisible();
    expect(screen.getByText(/PPDB 2027\/2028 · pendaftaran ditutup 31 Januari 2099/)).toBeVisible();
    expect(screen.getAllByText("2.500")[0]).toBeVisible();
  });

  it("says when there is no cycle at all", async () => {
    stubApi({ ...SIGNED_IN_STAFF, [DASHBOARD]: ok({ ...EMPTY_DASHBOARD, cycle: null }) });
    open("/");
    expect(await screen.findByText("Belum ada periode pendaftaran.")).toBeVisible();
  });
});

describe("Pendaftar", () => {
  const EMPTY_PAGE = ok({ rows: [], total: 0, page: 1, pageSize: 50 });

  it("says there is nobody yet, and offers the filters", async () => {
    stubApi({ ...SIGNED_IN_STAFF, [DASHBOARD]: ok(EMPTY_DASHBOARD), [LIST]: EMPTY_PAGE });
    open("/pendaftar");
    expect(await screen.findByText("Belum ada pendaftar.")).toBeVisible();
    const filters = screen.getByRole("navigation", { name: "Saring pendaftar" });
    expect(within(filters).getByRole("link", { name: "Perlu dicek" })).toHaveAttribute(
      "href",
      "/pendaftar?tampil=perlu",
    );
  });

  it("tells a search that matched nothing apart from an empty list", async () => {
    stubApi({ ...SIGNED_IN_STAFF, [DASHBOARD]: ok(EMPTY_DASHBOARD), [LIST]: EMPTY_PAGE });
    open("/pendaftar?cari=zzz");
    expect(await screen.findByText("Tidak ada pendaftar yang cocok.")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Cari pendaftar" })).toHaveValue("zzz");
  });

  it("answers another school's child with not found", async () => {
    stubApi({
      ...SIGNED_IN_STAFF,
      [DASHBOARD]: ok(EMPTY_DASHBOARD),
      "/api/rpc/staff/applications/get": rpc(404, "NOT_FOUND"),
    });
    open("/pendaftar/0f2d7c3a-9a0e-4c55-8f1b-6a2e9d4b7c10");
    expect(await screen.findByRole("heading", { name: "Pendaftar tidak ditemukan" })).toBeVisible();
  });
});
