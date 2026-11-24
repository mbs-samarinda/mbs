import type { CheckedStatus, FamilyStage } from "@mbs/api-contract";
import { APPLICATION_STAGES } from "@mbs/school-config";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ACCOUNT, open, refusal, stubApi } from "../../test/harness.tsx";
import { formatWait } from "../format.ts";

const SIGNED_OUT = { "/get-session": [{ body: null }] };
const CHECK = "public/application/checkStatus";
const NIK = "6472014105140001";

function statusOf(changes: Partial<CheckedStatus> = {}): CheckedStatus {
  return {
    registrationNumber: "SMP-0042",
    schoolKey: "smp",
    childName: "Muhammad Rafif Alfarizi",
    stage: "PAYMENT_DUE",
    finished: { REGISTRATION: "2026-12-01T16:30:00.000Z" },
    ...changes,
  };
}

const FOUND = { ...SIGNED_OUT, [CHECK]: [{ body: statusOf() }] };

async function ask(number = "smp 42", nik = "6472 0141 0514 0001") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Nomor pendaftaran"), number);
  await user.type(screen.getByLabelText("NIK anak"), nik);
  await user.click(screen.getByRole("button", { name: "Lihat status" }));
  return user;
}

const child = () => screen.findByRole("heading", { name: "Muhammad Rafif Alfarizi" });
const numberField = () => screen.findByLabelText("Nomor pendaftaran");

describe("the form", () => {
  it("is one press away from sign-in", async () => {
    stubApi(FOUND);
    const router = open("/masuk");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Cek status tanpa masuk" }));
    expect(await screen.findByRole("heading", { name: "Cek status pendaftaran" })).toHaveFocus();
    expect(router.state.location.href).toBe("/cek");
    await user.click(screen.getByRole("link", { name: "masuk dulu" }));
    expect(await screen.findByLabelText("Alamat email")).toBeVisible();
  });

  it("asks for both before it asks the server, with each error on its field", async () => {
    const calls = stubApi(FOUND);
    open("/cek");
    const number = await numberField();
    const nik = screen.getByLabelText("NIK anak");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Lihat status" }));
    expect(number).toHaveFocus();
    expect(number).toHaveAccessibleDescription("Isi nomor pendaftaran, misalnya SMP-0042.");
    expect(nik).toHaveAccessibleDescription(/Isi NIK anak/);

    await user.type(number, "SMP-0042");
    await user.type(nik, "123{Enter}");
    expect(number).toBeValid();
    expect(nik).toHaveFocus();
    expect(nik).toHaveAccessibleDescription(/Yang tertulis 3 angka/);
    expect(calls.filter(({ path }) => path === CHECK)).toEqual([]);
  });

  it("spends one try on a double press", async () => {
    const calls = stubApi(FOUND);
    open("/cek");
    const user = userEvent.setup();
    await user.type(await numberField(), "SMP-0042");
    await user.type(screen.getByLabelText("NIK anak"), NIK);
    // Two in one moment, before the button can show that the first is running.
    const form = (await numberField()).closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await child();
    expect(calls.filter(({ path }) => path === CHECK)).toEqual([
      { path: CHECK, body: { registrationNumber: "SMP-0042", nik: NIK } },
    ]);
  });

  it.each([
    ["a miss", refusal("NO_MATCH", 404), /belum cocok\. Periksa lagi keduanya/],
    [
      "a limit",
      refusal("TOO_MANY_TRIES", 429, { retryAfterSeconds: 840 }),
      "Terlalu banyak percobaan. Tunggu 14 menit, lalu coba lagi.",
    ],
    [
      "a day's limit",
      refusal("TOO_MANY_TRIES", 429, { retryAfterSeconds: 80_000 }),
      "Terlalu banyak percobaan. Tunggu 23 jam, lalu coba lagi.",
    ],
    ["a dead network", { lost: true }, /Server tidak bisa dihubungi/],
    ["a server fault", refusal("INTERNAL_SERVER_ERROR", 500), /Ada gangguan/],
  ])("explains %s and keeps what was typed", async (_, answer, message) => {
    stubApi({ ...SIGNED_OUT, [CHECK]: [answer] });
    open("/cek");
    await ask("SMP-0042", NIK);
    const alert = await screen.findByText(message);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(await numberField()).toHaveValue("SMP-0042");
    expect(screen.getByLabelText("NIK anak")).toHaveValue(NIK);
  });

  it("says the same for a number that cannot exist as for a wrong NIK", async () => {
    stubApi({ ...SIGNED_OUT, [CHECK]: [refusal("NO_MATCH", 404)] });
    open("/cek");
    await ask("bukan nomor", NIK);
    expect(await screen.findByText(/belum cocok/)).toBeVisible();
    expect(await numberField()).toBeValid();
  });

  it("drops the last answer's message when a field needs fixing first", async () => {
    stubApi({ ...SIGNED_OUT, [CHECK]: [refusal("NO_MATCH", 404)] });
    open("/cek");
    const user = await ask();
    await screen.findByText(/belum cocok/);
    await user.clear(await numberField());
    await user.click(screen.getByRole("button", { name: "Lihat status" }));
    expect(await numberField()).toHaveAccessibleDescription(/Isi nomor pendaftaran/);
    expect(screen.queryByText(/belum cocok/)).toBeNull();
  });

  it("lets a miss be followed by the right answer", async () => {
    stubApi({ ...SIGNED_OUT, [CHECK]: [refusal("NO_MATCH", 404), { body: statusOf() }] });
    open("/cek");
    const user = await ask();
    await screen.findByText(/belum cocok/);
    await user.click(screen.getByRole("button", { name: "Lihat status" }));
    expect(await child()).toBeVisible();
  });
});

describe("the answer", () => {
  it("shows the child, whose turn it is and the road", async () => {
    stubApi(FOUND);
    open("/cek");
    await ask();
    expect(await child()).toHaveFocus();
    expect(screen.getByText("SMP Islam Terpadu Madina")).toBeVisible();
    expect(screen.getByText("SMP-0042")).toBeVisible();
    expect(screen.getByText("Giliran keluarga")).toBeVisible();
    expect(
      screen.getByText("Pembayaran dikirim lewat akun yang mendaftarkan Muhammad Rafif Alfarizi."),
    ).toBeVisible();
    const road = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(road.map((item) => item.textContent)).toEqual([
      "Pendaftaran, selesai2 Desember",
      "Pembayaran, sekarang",
      "Dokumen, berikutnya",
      "Seleksi berkas, berikutnya",
      "Wawancara, berikutnya",
      "Pengumuman, berikutnya",
      "Daftar ulang, berikutnya",
    ]);
    expect(screen.getByRole("link", { name: "Masuk" })).toHaveAttribute("href", "/masuk");
  });

  it.each(APPLICATION_STAGES.filter((stage): stage is FamilyStage => stage !== "DECIDED"))(
    "never talks to the reader as the account holder at %s",
    async (stage) => {
      stubApi({ ...SIGNED_OUT, [CHECK]: [{ body: statusOf({ stage }) }] });
      open("/cek");
      await ask();
      await child();
      expect(document.body).not.toHaveTextContent(/\bkamu\b|undefined/i);
    },
  );

  it("offers a signed-in visitor their own page", async () => {
    stubApi({ ...FOUND, "/get-session": [{ body: { user: ACCOUNT } }] });
    open("/cek");
    await ask();
    await child();
    expect(await screen.findByRole("link", { name: "Buka halaman utama" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("is gone after Back, and stays gone after Forward", async () => {
    const calls = stubApi(FOUND);
    const router = open(["/masuk", "/cek"]);
    await ask();
    await child();

    router.history.back();
    expect(await numberField()).toHaveValue("");
    expect(screen.getByLabelText("NIK anak")).toHaveValue("");
    expect(router.state.location.href).toBe("/cek");

    router.history.forward();
    await waitFor(() => expect(router.state.location.state.checked).toBeDefined());
    expect(await numberField()).toHaveValue("");
    expect(screen.queryByText("Muhammad Rafif Alfarizi")).toBeNull();

    await ask();
    expect(await child()).toBeVisible();
    expect(calls.filter(({ path }) => path === CHECK)).toHaveLength(2);
  });

  it("goes back to an empty form after a reload on an older answer's page", async () => {
    stubApi(FOUND);
    const router = open(["/masuk", "/cek"]);
    await numberField();
    // What a reload leaves: the page is marked, and its answer is gone.
    router.history.push("/cek", { checked: "an older answer" });
    const user = await ask();
    await child();
    await user.click(screen.getByRole("button", { name: "Cek nomor lain" }));
    expect(await numberField()).toHaveValue("");
    expect(screen.queryByText("Muhammad Rafif Alfarizi")).toBeNull();
    expect(router.state.location.state.checked).toBe("an older answer");
  });

  it("goes back to an empty form for another number", async () => {
    stubApi(FOUND);
    open("/cek");
    const user = await ask();
    await child();
    await user.click(screen.getByRole("button", { name: "Cek nomor lain" }));
    expect(await numberField()).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Cek status pendaftaran" })).toHaveFocus();
  });

  it("is gone when the browser brings the page back as it was", async () => {
    stubApi(FOUND);
    open("/cek");
    await ask();
    await child();
    dispatchEvent(new Event("pagehide"));
    // At once, because a page that is put away runs nothing more.
    expect(screen.queryByText("Muhammad Rafif Alfarizi")).toBeNull();
    expect(screen.getByLabelText("NIK anak")).toHaveValue("");
  });

  it("does not pull back a visitor who left while it was on its way", async () => {
    const { promise: answered, resolve: answer } = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", (input: string | Request) =>
      typeof input === "string"
        ? Promise.resolve(Response.json(null, { headers: { "x-request-id": "1" } }))
        : answered,
    );
    const router = open("/cek");
    const user = await ask();
    await screen.findByRole("button", { name: "Memeriksa…" });
    await user.click(screen.getByRole("link", { name: "masuk dulu" }));
    await screen.findByLabelText("Alamat email");

    answer(Response.json({ json: statusOf() }, { headers: { "x-request-id": "1" } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toBe("/masuk");
  });

  it("leaves no trace in the URL, the title, the history or storage", async () => {
    stubApi(FOUND);
    const router = open("/cek");
    await ask();
    await child();
    const traces = JSON.stringify([
      router.state.location.href,
      router.state.location.state,
      document.title,
      Object.entries(localStorage),
      Object.entries(sessionStorage),
      history.state,
    ]);
    expect(traces).not.toMatch(/6472|Rafif|SMP-0042/);
  });
});

it.each([
  [1, "1 detik"],
  [59, "59 detik"],
  [60, "1 menit"],
  [61, "2 menit"],
  [3_540, "59 menit"],
  [3_541, "1 jam"],
  [86_400, "24 jam"],
])("says %i seconds as %s", (seconds, text) => {
  expect(formatWait(seconds)).toBe(text);
});
