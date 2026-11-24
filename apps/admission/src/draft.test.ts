import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, draftOf, editDraft, flushDraft, setAttempt } from "./draft.ts";

const KEY = "mbs:draft";

/** What a reload does: forget everything but what the device kept. */
function reload() {
  dispatchEvent(new StorageEvent("storage", { key: KEY }));
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(KEY) ?? "null");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearDraft();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the draft", () => {
  it("is written shortly after the last key, and read back after a reload", () => {
    editDraft("a", { childFullName: "Ais" });
    editDraft("a", { childFullName: "Aisyah" });
    expect(stored()).toBeNull();
    vi.advanceTimersByTime(400);
    const key = draftOf("a")?.key;
    reload();
    expect(draftOf("a")).toMatchObject({ key, values: { childFullName: "Aisyah" } });
  });

  it.each([
    ["the page goes away", () => dispatchEvent(new Event("pagehide"))],
    [
      "the page is hidden",
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("is written at once when %s", (_, leave) => {
    editDraft("a", { nik: "6472" });
    leave();
    expect(stored()).toMatchObject({ values: { nik: "6472" } });
  });

  it("keeps one key through every edit and an unanswered submit", () => {
    editDraft("a", { childFullName: "Aisyah" });
    const key = draftOf("a")?.key;
    setAttempt("a", { cycleId: crypto.randomUUID(), schoolKey: "smp" });
    editDraft("a", { childFullName: "Aisyah Putri" });
    flushDraft();
    reload();
    expect(draftOf("a")).toMatchObject({ key, attempt: { schoolKey: "smp" } });
  });

  it("is dropped, from the device too, when a different account signs in", () => {
    editDraft("a", { nik: "6472010101010001" });
    flushDraft();
    expect(draftOf("b")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    reload();
    expect(draftOf("a")).toBeNull();
  });

  it("does not come back from a write that was still waiting when it was cleared", () => {
    editDraft("a", { nik: "6472010101010001" });
    clearDraft();
    vi.advanceTimersByTime(1000);
    dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ["no JSON", "{"],
    ["no object", "[]"],
    ["an old version", (draft: object) => ({ ...draft, version: 0 })],
    ["a value of another kind", (draft: object) => ({ ...draft, values: { nik: 1 } })],
    ["a key the server would refuse", (draft: object) => ({ ...draft, key: "1" })],
    ["no attempt field", (draft: object) => ({ ...draft, attempt: undefined })],
    ["half an attempt", (draft: object) => ({ ...draft, attempt: { schoolKey: "smp" } })],
  ])("with %s is dropped and nothing breaks", (_, change) => {
    editDraft("a", { childFullName: "Aisyah" });
    flushDraft();
    localStorage.setItem(
      KEY,
      typeof change === "string" ? change : JSON.stringify(change(Object(stored()))),
    );
    reload();
    expect(draftOf("a")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    editDraft("a", { childFullName: "Aisyah" });
    expect(draftOf("a")?.values.childFullName).toBe("Aisyah");
  });

  it("goes on in memory when the device stores nothing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    editDraft("a", { childFullName: "Aisyah" });
    flushDraft();
    expect(draftOf("a")?.values.childFullName).toBe("Aisyah");
  });

  it("goes on when the device refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    reload();
    expect(draftOf("a")).toBeNull();
    editDraft("a", { childFullName: "Aisyah" });
    expect(draftOf("a")?.values.childFullName).toBe("Aisyah");
  });

  it("takes another tab's write, unless this tab has one of its own waiting", () => {
    editDraft("a", { childFullName: "Pertama" });
    flushDraft();
    const other = { ...Object(stored()), values: { ...Object(stored()).values, nik: "1" } };
    localStorage.setItem(KEY, JSON.stringify(other));
    reload();
    expect(draftOf("a")?.values).toMatchObject({ childFullName: "Pertama", nik: "1" });

    editDraft("a", { childFullName: "Kedua" });
    reload();
    flushDraft();
    expect(stored()).toMatchObject({ values: { childFullName: "Kedua", nik: "1" } });
  });
});
