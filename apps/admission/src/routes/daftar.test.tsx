import { APPLICANT_RULES } from "@mbs/api-contract/applicant-rules";
import type { SchoolKey } from "@mbs/school-config";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT,
  APPLICATION_ID,
  CYCLES,
  cycleOf,
  GET,
  applicationOf,
  LIST,
  open,
  READY,
  refusal,
  stubApi,
  SUBMIT,
} from "../../test/harness.tsx";
import { draftOf, editDraft, EMPTY_VALUES, flushDraft, type Values } from "../draft.ts";

const FILLED: Values = {
  schoolKey: "smp",
  childFullName: "Muhammad Rafif Alfarizi",
  nik: "6472 0209 0714 0003",
  birthDay: "9",
  birthMonth: "07",
  birthYear: "2014",
  sex: "MALE",
  schoolOfOrigin: "SDN 004 Samarinda Ulu",
  guardianName: "Nurhayati Lestari",
  guardianRelation: "MOTHER",
  guardianPhone: "0812 5567 1034",
};

function fill(changes: Partial<Values> = {}) {
  editDraft(ACCOUNT.id, { ...FILLED, ...changes });
  flushDraft();
  return draftOf(ACCOUNT.id)!.key;
}

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
const press = (name: string) => userEvent.setup().click(screen.getByRole("button", { name }));

describe("the step guard", () => {
  it.each([
    ["nothing", {}, "periksa", "sekolah"],
    ["a school", { schoolKey: "smp" }, "periksa", "anak"],
    ["a school", { schoolKey: "smp" }, "wali", "anak"],
    ["a child with a wrong NIK", { ...FILLED, nik: "123" }, "periksa", "anak"],
    ["no guardian", { ...FILLED, guardianName: " " }, "periksa", "wali"],
    ["everything", FILLED, "periksa", "periksa"],
    ["everything", FILLED, "anak", "anak"],
    ["everything", FILLED, "", "periksa"],
  ])("with %s filled, /daftar/… asked for %s opens %s", async (_, values, asked, opened) => {
    stubApi(READY);
    if (Object.keys(values).length > 0) editDraft(ACCOUNT.id, { ...EMPTY_VALUES, ...values });
    const router = open(asked ? `/daftar/${asked}` : "/daftar");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/daftar/${opened}`));
  });

  it("asks for the school again when the chosen one closed", async () => {
    stubApi({
      ...READY,
      [CYCLES]: (schoolKey: SchoolKey) => ({
        body: schoolKey === "smp" ? null : cycleOf(schoolKey),
      }),
    });
    fill();
    const router = open("/daftar/periksa");
    await waitFor(() => expect(router.state.location.pathname).toBe("/daftar/sekolah"));
    expect(screen.queryByRole("radio", { name: /SMP/ })).toBeNull();
  });

  it("offers no form while every school is closed", async () => {
    stubApi({ ...READY, [CYCLES]: [{ body: cycleOf("smp", { status: "CLOSED" }) }] });
    const router = open("/daftar/sekolah");
    expect(await heading("Pendaftaran sudah ditutup")).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
  });

  it("answers a step that does not exist as a page that does not exist", async () => {
    stubApi(READY);
    open("/daftar/apa");
    expect(await heading("Halaman tidak ditemukan")).toBeVisible();
  });
});

describe("a step", () => {
  it("ties each error to its field, announces how many, and focuses the first", async () => {
    stubApi(READY);
    editDraft(ACCOUNT.id, { schoolKey: "smp", childFullName: "Aisyah" });
    open("/daftar/anak");
    await heading("Data anak");
    expect(screen.queryByText(/Isi NIK/)).toBeNull();
    await press("Lanjut");

    const nik = screen.getByLabelText("NIK anak");
    expect(nik).toHaveFocus();
    expect(nik).toBeInvalid();
    expect(nik).toHaveAccessibleDescription(expect.stringContaining("Isi NIK anak"));
    expect(screen.getByLabelText("Nama lengkap anak")).toBeValid();
    expect(screen.getByRole("group", { name: "Tanggal lahir" })).toHaveAccessibleDescription(
      /Isi tanggal, bulan, dan tahun/,
    );
    expect(screen.getByRole("group", { name: "Jenis kelamin" })).toHaveAccessibleDescription(
      "Pilih jenis kelamin anak.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ada 4 isian yang perlu diperbaiki.");
  });

  it("checks a field again as it changes, once it was checked", async () => {
    stubApi(READY);
    editDraft(ACCOUNT.id, { ...FILLED, nik: "" });
    open("/daftar/anak");
    const user = userEvent.setup();
    const nik = await screen.findByLabelText("NIK anak");
    await user.type(nik, "647202090714000{Enter}");
    expect(nik).toHaveAccessibleDescription(expect.stringContaining("15 angka"));
    await user.type(nik, "3");
    expect(nik).toBeValid();
    await user.keyboard("{Enter}");
    expect(await heading("Orang tua/wali")).toBeVisible();
  });

  it("asks for all of the birth date when the day alone is missing", async () => {
    stubApi(READY);
    fill({ birthDay: "" });
    open("/daftar/anak");
    await heading("Data anak");
    await press("Lanjut");
    expect(screen.getByRole("group", { name: "Tanggal lahir" })).toHaveAccessibleDescription(
      /Isi tanggal, bulan, dan tahun/,
    );
  });

  it("focuses the part of the birth date that is missing", async () => {
    stubApi(READY);
    fill({ birthYear: "" });
    open("/daftar/anak");
    await heading("Data anak");
    await press("Lanjut");
    expect(screen.getByLabelText("Tahun")).toHaveFocus();
  });

  it("keeps the guardian's autofill out of the child's fields", async () => {
    stubApi(READY);
    fill();
    open("/daftar/anak");
    await heading("Data anak");
    for (const label of ["Nama lengkap anak", "NIK anak", "Tanggal", "Bulan", "Tahun"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
    }
  });

  it("goes forward by Lanjut, and back the same way by Kembali and by the browser", async () => {
    stubApi(READY);
    fill();
    const router = open("/daftar/sekolah");
    await heading("Pilih sekolah");
    await press("Lanjut");
    await heading("Data anak");
    await press("Lanjut");
    await heading("Orang tua/wali");
    await press("Kembali");
    await heading("Data anak");
    router.history.back();
    await heading("Pilih sekolah");
    expect(router.history.length).toBe(3);
    expect(screen.queryByRole("button", { name: "Kembali" })).toBeNull();
  });

  it("comes back to the check after Ubah, and leaves no extra page in the history", async () => {
    stubApi(READY);
    fill();
    const router = open(["/", "/daftar/periksa"]);
    await heading("Periksa sebelum dikirim");
    await userEvent.setup().click(screen.getByRole("link", { name: "Ubah orang tua/wali" }));
    const name = await screen.findByLabelText("Nama lengkap orang tua/wali");
    const user = userEvent.setup();
    await user.clear(name);
    await user.type(name, "Siti{Enter}");
    await heading("Periksa sebelum dikirim");
    expect(screen.getByText("Siti")).toBeVisible();
    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("says the form is kept only when the device kept it", async () => {
    stubApi(READY);
    fill();
    open("/daftar/anak");
    expect(await screen.findByText("Isian tersimpan di perangkat ini")).toBeVisible();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await userEvent.setup().type(screen.getByLabelText("Asal sekolah"), " 2");
    await waitFor(() => expect(screen.queryByText("Isian tersimpan di perangkat ini")).toBeNull());
    expect(screen.getByLabelText("Asal sekolah")).toHaveValue("SDN 004 Samarinda Ulu 2");
  });

  it("judges the child's age by the server's clock, not the phone's", async () => {
    // A phone reset to 2010 would call every child unborn.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2010-01-01T00:00:00Z") });
    stubApi(READY, "2026-12-01T00:00:00Z");
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    expect(router.state.location.pathname).toBe("/daftar/periksa");
    expect(APPLICANT_RULES.birthDate("2014-07-09", new Date()).ok).toBe(false);
  });
});

/** A submit that waits for `answer`. */
function holdSubmit() {
  const { promise, resolve } = Promise.withResolvers<null>();
  const calls = stubApi(READY);
  const fetched = fetch;
  vi.stubGlobal("fetch", async (input: Request, init: RequestInit) => {
    if (typeof input !== "string" && input.url.endsWith(SUBMIT)) await promise;
    return fetched(input, init);
  });
  return { calls, answer: () => resolve(null) };
}

describe("the check", () => {
  it("lists everything, with the email the news goes to", async () => {
    stubApi(READY);
    fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    const main = within(screen.getByRole("main"));
    for (const text of [
      "SMP Islam Terpadu Madina",
      "Rp250.000",
      FILLED.childFullName,
      "6472 0209 0714 0003",
      "9 Juli 2014",
      "Laki-laki",
      FILLED.schoolOfOrigin,
      FILLED.guardianName,
      "Ibu",
      FILLED.guardianPhone,
      ACCOUNT.email,
    ]) {
      expect(main.getAllByText(text)[0]).toBeVisible();
    }
  });

  it("sends the form once on a double press and opens its status, with no form behind it", async () => {
    const calls = stubApi(READY);
    const key = fill();
    const router = open(["/", "/daftar/sekolah"]);
    for (const step of ["Pilih sekolah", "Data anak", "Orang tua/wali"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await heading(step);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await press("Lanjut");
    }
    await heading("Periksa sebelum dikirim");
    await userEvent.setup().dblClick(screen.getByRole("button", { name: "Kirim pendaftaran" }));

    expect(await screen.findByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeVisible();
    const sent = calls.filter(({ path }) => path === SUBMIT);
    expect(sent.map(({ body }) => body)).toEqual([
      {
        cycleId: cycleOf("smp").id,
        schoolKey: "smp",
        idempotencyKey: key,
        profile: {
          childFullName: FILLED.childFullName,
          nik: FILLED.nik,
          birthDate: "2014-07-09",
          sex: "MALE",
          schoolOfOrigin: FILLED.schoolOfOrigin,
          guardianName: FILLED.guardianName,
          guardianRelation: "MOTHER",
          guardianPhone: FILLED.guardianPhone,
        },
      },
    ]);
    await waitFor(() => expect(localStorage.getItem("mbs:draft")).toBeNull());
    expect(router.state.location.pathname).toBe(`/status/${APPLICATION_ID}`);

    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    router.history.go(2);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/status/${APPLICATION_ID}`));
  });

  it("lists the new child on home right away, not the empty page from before", async () => {
    stubApi({ ...READY, [LIST]: [{ body: [] }, { body: [] }, { body: [applicationOf()] }] });
    fill();
    open("/");
    await userEvent.setup().click(await screen.findByRole("link", { name: /Belum dikirim/ }));
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByRole("heading", { name: "Bayar biaya pendaftaran" });
    await waitFor(() => expect(localStorage.getItem("mbs:draft")).toBeNull());
    const seen = new Set<string | null>();
    const watch = new MutationObserver(() =>
      seen.add(document.querySelector("h1")?.textContent ?? null),
    );
    watch.observe(document.body, { childList: true, subtree: true });
    await userEvent.setup().click(screen.getByRole("link", { name: "Semua pendaftaran" }));
    expect(await screen.findByRole("link", { name: /Aisyah Putri/ })).toBeVisible();
    watch.disconnect();
    expect(seen).not.toContain("Pilih sekolah");
  });

  it("still opens the status when another tab sent the same form first", async () => {
    const { answer, calls } = holdSubmit();
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    localStorage.removeItem("mbs:draft");
    dispatchEvent(new StorageEvent("storage", { key: "mbs:draft" }));
    answer();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/status/${APPLICATION_ID}`));
    expect(calls.filter(({ path }) => path === SUBMIT)).toHaveLength(1);
  });

  it("takes no edits and no second send while the first is on its way", async () => {
    const { answer, calls } = holdSubmit();
    fill();
    const router = open(["/daftar/wali", "/daftar/periksa"]);
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    expect(screen.getByRole("button", { name: "Kembali" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Ubah anak" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    router.history.back();
    expect(await screen.findByText(/sedang dikirim/)).toBeVisible();
    expect(screen.queryByLabelText("Nomor HP")).toBeNull();
    router.history.forward();
    await heading("Periksa sebelum dikirim");
    await userEvent.setup().click(screen.getByRole("button", { name: "Mengirim…" }));
    answer();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/status/${APPLICATION_ID}`));
    expect(calls.filter(({ path }) => path === SUBMIT)).toHaveLength(1);
    expect(router.history.length).toBe(2);
  });

  it("says so when another tab edited the form while it was on its way", async () => {
    const { answer } = holdSubmit();
    fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    const stored = JSON.parse(localStorage.getItem("mbs:draft")!);
    stored.values.guardianPhone = "0813 1111 2222";
    localStorage.setItem("mbs:draft", JSON.stringify(stored));
    dispatchEvent(new StorageEvent("storage", { key: "mbs:draft" }));
    answer();
    expect(await screen.findByText(/ubahan itu tidak ikut terkirim/)).toBeVisible();
  });

  it("leaves the check when another tab empties a field", async () => {
    stubApi(READY);
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    const stored = JSON.parse(localStorage.getItem("mbs:draft")!);
    stored.values.birthDay = "";
    localStorage.setItem("mbs:draft", JSON.stringify(stored));
    dispatchEvent(new StorageEvent("storage", { key: "mbs:draft" }));
    await heading("Data anak");
    expect(router.state.location.pathname).toBe("/daftar/anak");
  });

  it("offers the school an unanswered try went to, after every school closed", async () => {
    stubApi({ ...READY, [SUBMIT]: [{ lost: true }] });
    fill();
    const first = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByText(/tidak akan tercatat dua kali/);
    editDraft(ACCOUNT.id, { schoolKey: "sma" });
    flushDraft();
    first.unmount();

    stubApi({ ...READY, [CYCLES]: [{ body: null }] });
    open("/daftar");
    await heading("Pilih sekolah");
    await userEvent.setup().click(screen.getByRole("radio", { name: /SMP/ }));
    await press("Lanjut");
    await heading("Data anak");
  });

  it("goes home when another tab sent the form and nothing is running here", async () => {
    stubApi(READY);
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    localStorage.removeItem("mbs:draft");
    dispatchEvent(new StorageEvent("storage", { key: "mbs:draft" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("sends the same request again after a lost answer, a reload and a closed cycle", async () => {
    const calls = stubApi({ ...READY, [SUBMIT]: [{ lost: true }, READY[SUBMIT][0]!] });
    const key = fill();
    const first = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    expect(await screen.findByText(/tidak akan tercatat dua kali/)).toBeVisible();
    first.unmount();
    dispatchEvent(new StorageEvent("storage", { key: null }));

    const closed = stubApi({
      ...READY,
      [CYCLES]: [{ body: null }],
      [LIST]: [{ body: [] }],
    });
    open("/");
    await userEvent
      .setup()
      .click(await screen.findByRole("link", { name: /Belum pasti terkirim/ }));
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    expect(await screen.findByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeVisible();

    const lost = calls.find(({ path }) => path === SUBMIT);
    const replayed = closed.find(({ path }) => path === SUBMIT);
    expect(replayed?.body).toEqual(lost?.body);
    expect(replayed?.body).toMatchObject({ idempotencyKey: key });
  });

  it("opens the application that exists when the form was edited after a lost answer", async () => {
    stubApi({
      ...READY,
      [SUBMIT]: [
        { lost: true },
        refusal("IDEMPOTENCY_KEY_REUSED", 409, {
          applicationId: APPLICATION_ID,
          sameRegistration: true,
        }),
      ],
    });
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByText(/tidak akan tercatat dua kali/);
    editDraft(ACCOUNT.id, { childFullName: "Rafif" });
    await press("Kirim pendaftaran");

    expect(await screen.findByText(/ubahan itu tidak ikut terkirim/)).toBeVisible();
    expect(router.state.location.pathname).toBe(`/status/${APPLICATION_ID}`);
    await waitFor(() => expect(localStorage.getItem("mbs:draft")).toBeNull());
  });

  it("keeps a form for another child, with a key of its own, when its key was used", async () => {
    stubApi({
      ...READY,
      [SUBMIT]: [
        refusal("IDEMPOTENCY_KEY_REUSED", 409, {
          applicationId: APPLICATION_ID,
          sameRegistration: false,
        }),
      ],
    });
    const key = fill({ childFullName: "Anak kedua" });
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");

    await userEvent.setup().click(await screen.findByRole("link", { name: "Lanjutkan isian" }));
    await heading("Periksa sebelum dikirim");
    expect(screen.getByText("Anak kedua")).toBeVisible();
    expect(draftOf(ACCOUNT.id)?.key).not.toBe(key);
  });

  it("makes one application with the edited form when the first never arrived", async () => {
    const calls = stubApi({ ...READY, [SUBMIT]: [{ lost: true }, READY[SUBMIT][0]!] });
    const key = fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByText(/tidak akan tercatat dua kali/);
    editDraft(ACCOUNT.id, { childFullName: "Rafif" });
    await press("Kirim pendaftaran");
    await screen.findByRole("heading", { name: "Bayar biaya pendaftaran" });
    expect(calls.findLast(({ path }) => path === SUBMIT)?.body).toMatchObject({
      idempotencyKey: key,
      profile: { childFullName: "Rafif" },
    });
  });

  it.each([
    ["REGISTRATION_CLOSED", /Pendaftaran di SMP Islam Terpadu Madina sudah ditutup/],
    ["NOT_FOUND", /sudah ditutup/],
    ["DUPLICATE_APPLICATION", /NIK ini sudah terdaftar di SMP Islam Terpadu Madina/],
    ["TOO_MANY_CHILDREN", /paling banyak 10 anak/],
  ])("explains %s, keeps the form and shows a way out", async (code, message) => {
    stubApi({ ...READY, [SUBMIT]: [refusal(code, code === "NOT_FOUND" ? 404 : 409)] });
    fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole("link", { name: "Buka halaman utama" })).toHaveAttribute("href", "/");
    expect(draftOf(ACCOUNT.id)).toMatchObject({ values: FILLED, attempt: null });
  });

  it("shows the server's own words for a form it refuses", async () => {
    stubApi({
      ...READY,
      [SUBMIT]: [
        refusal("BAD_REQUEST", 400, {
          issues: [
            { path: ["profile", "birthDate"], message: "Umur anak harus 8 sampai 25 tahun." },
          ],
        }),
      ],
    });
    fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    expect(await screen.findByText("Umur anak harus 8 sampai 25 tahun.")).toBeVisible();
    expect(draftOf(ACCOUNT.id)?.attempt).toBeNull();
  });

  it("stays unsure of a lost answer when a later try is refused before its key is looked for", async () => {
    stubApi({ ...READY, [SUBMIT]: [{ lost: true }, refusal("BAD_REQUEST", 400, { issues: [] })] });
    fill();
    open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByText(/tidak akan tercatat dua kali/);
    await press("Kirim pendaftaran");
    await screen.findByRole("button", { name: "Kirim pendaftaran" });
    await waitFor(() => expect(draftOf(ACCOUNT.id)?.attempt).toMatchObject({ schoolKey: "smp" }));
  });

  it("signs in again when the session ended, and comes back with the form as it was", async () => {
    stubApi({ ...READY, [SUBMIT]: [refusal("UNAUTHORIZED", 401)] });
    fill();
    const router = open("/daftar/periksa");
    await heading("Periksa sebelum dikirim");
    await press("Kirim pendaftaran");
    await screen.findByLabelText("Alamat email");
    expect(router.state.location.href).toBe("/masuk?lanjut=%2Fdaftar%2Fperiksa");
    expect(localStorage.getItem("mbs:draft")).toContain(FILLED.childFullName);
  });

  it("shows no other account's form, and drops it", async () => {
    fill();
    stubApi({
      ...READY,
      "/get-session": [{ body: { user: { id: "family-b", email: "lain@example.test" } } }],
    });
    const router = open("/daftar/periksa");
    await waitFor(() => expect(router.state.location.pathname).toBe("/daftar/sekolah"));
    expect(localStorage.getItem("mbs:draft")).toBeNull();
  });

  it("forgets the form on sign-out", async () => {
    stubApi({ ...READY, "/sign-out": [{ body: { success: true } }] });
    fill();
    open("/daftar/anak");
    await userEvent.setup().type(await screen.findByLabelText("Asal sekolah"), "x");
    await press("Keluar");
    await screen.findByLabelText("Alamat email");
    expect(localStorage.getItem("mbs:draft")).toBeNull();
  });
});

describe("home", () => {
  it("lists the children with their stage and whose turn it is", async () => {
    stubApi({
      ...READY,
      [LIST]: [
        {
          body: [
            applicationOf(),
            applicationOf({
              id: "22222222-2222-4222-8222-222222222222",
              childName: "Umar",
              schoolKey: "sma",
              stage: "DOCUMENTS_REVIEW",
            }),
            applicationOf({
              id: "33333333-3333-4333-8333-333333333333",
              childName: "Zahra",
              stage: "ENROLLED",
            }),
          ],
        },
      ],
    });
    open("/");
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Aisyah PutriSMP Islam Terpadu MadinaBayar biaya pendaftaran · Giliran kamu",
      "UmarSMA Madina Citra InsaniPanitia memeriksa dokumen · Giliran panitia",
      "ZahraSMP Islam Terpadu MadinaResmi terdaftar",
    ]);
    expect(screen.getByRole("link", { name: "Daftarkan anak lain" })).toBeVisible();
  });

  it("offers to go on with a form instead of starting another", async () => {
    stubApi({ ...READY, [LIST]: [{ body: [applicationOf()] }] });
    fill();
    open("/");
    expect(await screen.findByRole("link", { name: /Rafif.*Belum dikirim/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Daftarkan anak lain" })).toBeNull();
  });

  it("offers no form while every school is closed", async () => {
    stubApi({ ...READY, [CYCLES]: [{ body: null }], [LIST]: [{ body: [applicationOf()] }] });
    fill();
    open("/");
    expect(await screen.findByText("Aisyah Putri")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Belum dikirim|Daftarkan/ })).toBeNull();
  });

  const FUTURE = "2098-12-01T00:00:00.000Z";
  it.each([
    ["none announced", null, "Pendaftaran belum dibuka", /Jadwalnya belum diumumkan/],
    [
      "opening later",
      cycleOf("smp", { registrationOpenAt: FUTURE }),
      "Pendaftaran dibuka 1 Desember 2098",
      /dibuka pukul 08\.00 WITA/,
    ],
    [
      "past its window",
      cycleOf("smp", { registrationCloseAt: "2026-03-31T15:59:00.000Z" }),
      "Pendaftaran sudah ditutup",
      /ditutup 31 Maret 2026\./,
    ],
    [
      "closed early",
      cycleOf("smp", { status: "CLOSED" }),
      "Pendaftaran sudah ditutup",
      /PPDB 2027\/2028 ditutup\. Jadwal/,
    ],
    ["open", cycleOf("smp"), "Pilih sekolah", /dibuka sampai 31 Maret 2099, 23\.59 WITA/],
  ])("with every school %s, says so", async (_, cycle, title, body) => {
    stubApi({ ...READY, [CYCLES]: [{ body: cycle }] });
    open("/");
    expect(await heading(title)).toBeVisible();
    expect(screen.getByText(body)).toBeVisible();
  });

  it("lists the open schools and names the one that takes no one", async () => {
    stubApi({
      ...READY,
      [CYCLES]: (schoolKey: SchoolKey) => ({
        body: schoolKey === "smk" ? null : cycleOf(schoolKey),
      }),
    });
    const router = open("/");
    await heading("Pilih sekolah");
    expect(screen.getByText(/SMK Terpadu Madina tidak menerima pendaftaran/)).toBeVisible();
    await userEvent.setup().click(screen.getByRole("link", { name: /SMA Madina/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/daftar/anak"));
    expect(screen.getByText("SMA Madina Citra Insani")).toBeVisible();
  });
});

const at = (day: number) => `2026-12-0${day}T01:10:00.000Z`;

const lines = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("the status page", () => {
  it("answers an id that is not theirs, or not an id, as a page that does not exist", async () => {
    stubApi({ ...READY, [GET]: [refusal("NOT_FOUND", 404)] });
    open(`/status/${APPLICATION_ID}`);
    expect(await heading("Halaman tidak ditemukan")).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("shows the road, the history newest first, and the committee's reason", async () => {
    stubApi({
      ...READY,
      [GET]: [
        {
          body: applicationOf({
            stage: "DOCUMENTS_DUE",
            documents: [
              { type: "KARTU_KELUARGA", required: true },
              { type: "AKTA_KELAHIRAN", required: true },
              { type: "IJAZAH", required: false },
            ],
            events: [
              { command: "SUBMIT", at: "2026-12-01T16:30:00.000Z", actor: "FAMILY", reason: null },
              { command: "UPLOAD_PAYMENT_PROOF", at: at(3), actor: "FAMILY", reason: null },
              { command: "REJECT_PAYMENT", at: at(4), actor: "STAFF", reason: "Nominal buram." },
              { command: "APPROVE_PAYMENT", at: at(5), actor: "STAFF", reason: null },
              { command: "EDIT_PROFILE", at: at(6), actor: "STAFF", reason: null },
            ],
          }),
        },
      ],
    });
    open(`/status/${APPLICATION_ID}`);
    await heading("Aisyah Putri");
    expect(
      screen.getByText(
        "Siapkan kartu keluarga dan akta kelahiran. Kalau ada, siapkan juga ijazah atau surat keterangan lulus. Tempat mengunggahnya akan muncul di halaman ini.",
      ),
    ).toBeVisible();

    const [road, history] = screen.getAllByRole("list");
    expect(lines(road!)).toEqual([
      "Pendaftaran, selesai2 Desember",
      "Pembayaran, selesai5 Desember",
      "Dokumen, sekarang",
      "Seleksi berkas, berikutnya",
      "Wawancara, berikutnya",
      "Pengumuman, berikutnya",
      "Daftar ulang, berikutnya",
    ]);
    expect(lines(history!)).toEqual([
      "Data pendaftaran diubah oleh panitia6 Desember 2026, 09.10 WITA",
      "Pembayaran dikonfirmasi5 Desember 2026, 09.10 WITA",
      "Bukti transfer perlu diunggah ulangCatatan panitia: Nominal buram.4 Desember 2026, 09.10 WITA",
      "Bukti transfer dikirim3 Desember 2026, 09.10 WITA",
      "Pendaftaran dikirim2 Desember 2026, 00.30 WITA",
    ]);
  });

  it("keeps the next step of a receipt sent back when the form was edited after it", async () => {
    stubApi({
      ...READY,
      [GET]: [
        {
          body: applicationOf({
            events: [
              { command: "SUBMIT", at: at(2), actor: "FAMILY", reason: null },
              { command: "REJECT_PAYMENT", at: at(3), actor: "STAFF", reason: "Nominal buram." },
              { command: "EDIT_PROFILE", at: at(4), actor: "STAFF", reason: null },
            ],
          }),
        },
      ],
    });
    open(`/status/${APPLICATION_ID}`);
    await heading("Aisyah Putri");
    expect(screen.getByText(/Baca catatan panitia, lalu unggah bukti lagi/)).toBeVisible();
    expect(screen.getAllByText("Catatan panitia: Nominal buram.")).toHaveLength(2);
  });

  it("stops saying that edits are kept once they are gone", async () => {
    stubApi(READY);
    open(`/status/${APPLICATION_ID}?ubahan=tersimpan`);
    await heading("Aisyah Putri");
    expect(screen.queryByText(/masih ada di perangkat ini/)).toBeNull();
  });

  it("ends the road where the application ended", async () => {
    const event = { at: "2026-12-02T00:00:00.000Z", actor: "STAFF", reason: null } as const;
    stubApi({
      ...READY,
      [GET]: [
        {
          body: applicationOf({
            stage: "NOT_ADVANCED",
            events: [
              { ...event, command: "SUBMIT" },
              { ...event, command: "APPROVE_PAYMENT" },
              { ...event, command: "VERIFY_DOCUMENTS" },
              { ...event, command: "STOP_AT_SCREENING", reason: "Belum memenuhi syarat usia." },
            ],
          }),
        },
      ],
    });
    open(`/status/${APPLICATION_ID}`);
    await heading("Aisyah Putri");
    const [road] = screen.getAllByRole("list");
    expect(within(road!).getAllByRole("listitem").at(-1)).toHaveTextContent("Seleksi berkas");
    expect(screen.getAllByText("Catatan panitia: Belum memenuhi syarat usia.")).toHaveLength(2);
  });

  it("loads again when the family comes back to the page", async () => {
    stubApi({
      ...READY,
      [GET]: [
        { body: applicationOf() },
        { body: applicationOf() },
        { body: applicationOf({ stage: "PAYMENT_REVIEW" }) },
      ],
    });
    open(`/status/${APPLICATION_ID}`);
    await screen.findByRole("heading", { name: "Bayar biaya pendaftaran" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(
      await screen.findByRole("heading", { name: "Panitia memeriksa bukti transfer" }),
    ).toBeVisible();
  });

  it("leaves when another account signed in elsewhere", async () => {
    const other = { id: "family-b", email: "lain@example.test" };
    stubApi({
      ...READY,
      "/get-session": [{ body: { user: ACCOUNT } }, { body: { user: other } }],
      [GET]: [{ body: applicationOf() }, { body: applicationOf() }, refusal("NOT_FOUND", 404)],
    });
    open(`/status/${APPLICATION_ID}`);
    await heading("Aisyah Putri");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(await screen.findByText(other.email)).toBeVisible();
    expect(screen.queryByText("Aisyah Putri")).toBeNull();
  });
});
