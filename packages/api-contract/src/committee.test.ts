import { describe, expect, it } from "vitest";

import { AddNoteInput, HistoryItem, ListApplicationsInput } from "./committee.ts";

const key = "5b0c2f9e-3f63-4a4f-9a51-1f7e0f8a0c11";
const applicationId = "0f2d7c3a-9a0e-4c55-8f1b-6a2e9d4b7c10";

describe("AddNoteInput", () => {
  it("trims a note and refuses one that is only spaces", () => {
    expect(
      AddNoteInput.parse({ applicationId, note: "  Telepon sore.  ", idempotencyKey: key }),
    ).toMatchObject({ note: "Telepon sore." });
    expect(
      AddNoteInput.safeParse({ applicationId, note: "   ", idempotencyKey: key }).success,
    ).toBe(false);
  });

  it("refuses a note over 2,000 characters and one without a key", () => {
    expect(
      AddNoteInput.safeParse({ applicationId, note: "a".repeat(2001), idempotencyKey: key })
        .success,
    ).toBe(false);
    expect(AddNoteInput.safeParse({ applicationId, note: "Oke" }).success).toBe(false);
  });
});

describe("ListApplicationsInput", () => {
  it("refuses a search longer than 100 characters and a page below 1", () => {
    expect(
      ListApplicationsInput.safeParse({ view: "ALL", q: "a".repeat(101), page: 1 }).success,
    ).toBe(false);
    expect(ListApplicationsInput.safeParse({ view: "ALL", page: 0 }).success).toBe(false);
  });
});

describe("HistoryItem", () => {
  it("names nobody for a status check without an account", () => {
    const row = {
      kind: "AUDIT",
      action: "application.status_checked",
      actor: { type: "PUBLIC" },
      at: "2026-11-24T02:00:00.000Z",
    };
    expect(HistoryItem.parse(row)).toEqual(row);
  });

  it("refuses a staff actor without a name", () => {
    expect(
      HistoryItem.safeParse({
        kind: "AUDIT",
        action: "application.viewed",
        actor: { type: "STAFF" },
        at: "2026-11-24T02:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
