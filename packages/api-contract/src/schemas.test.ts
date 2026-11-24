import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicantProfile } from "./application.ts";
import { CreateCycleInput, CreateStaffInput, UpsertSchoolSettingInput } from "./schemas.ts";

const cycle = {
  name: "2027/2028",
  registrationOpenAt: "2026-11-01T00:00:00.000Z",
  registrationCloseAt: "2026-12-31T00:00:00.000Z",
  resultPublishAt: "2027-01-15T00:00:00.000Z",
  defaultFee: 250_000,
};

describe("CreateCycleInput", () => {
  it("accepts a well ordered cycle", () => {
    expect(CreateCycleInput.safeParse(cycle).success).toBe(true);
  });

  // The two timestamps are one second apart but compare the other way as
  // strings, because "Z" sorts after ".". Ordering has to run on instants.
  it("compares instants, not ISO strings", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      registrationOpenAt: "2026-11-01T10:00:00Z",
      registrationCloseAt: "2026-11-01T10:00:00.500Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a close before the open", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      registrationCloseAt: "2026-10-01T00:00:00.000Z",
    });

    expect(result.error?.issues[0]?.path).toEqual(["registrationCloseAt"]);
  });

  it("rejects a result published before registration closes", () => {
    const result = CreateCycleInput.safeParse({
      ...cycle,
      resultPublishAt: "2026-12-01T00:00:00.000Z",
    });

    expect(result.error?.issues[0]?.path).toEqual(["resultPublishAt"]);
  });

  // Without the ceiling this reaches Postgres and comes back as a 500.
  it("rejects a fee the integer column cannot hold", () => {
    expect(CreateCycleInput.safeParse({ ...cycle, defaultFee: 3_000_000_000 }).success).toBe(false);
  });
});

describe("UpsertSchoolSettingInput", () => {
  it("rejects a repeated document type", () => {
    const result = UpsertSchoolSettingInput.safeParse({
      cycleId: "00000000-0000-0000-0000-000000000001",
      schoolKey: "sma",
      isEnabled: true,
      feeOverride: null,
      acceptedInstructions: null,
      rejectedInstructions: null,
      documents: [
        { type: "IJAZAH", required: true },
        { type: "IJAZAH", required: false },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("CreateStaffInput", () => {
  it("trims and lowercases the email", () => {
    const parsed = CreateStaffInput.parse({
      name: "Panitia",
      email: " Panitia@MBSS.sch.id ",
      role: "STAFF",
      schools: ["sma"],
    });

    expect(parsed.email).toBe("panitia@mbss.sch.id");
  });
});

describe("ApplicantProfile", () => {
  const typed = {
    childFullName: "Aisyah Putri",
    nik: "6472010101010001",
    birthDate: "2014-05-01",
    sex: "FEMALE",
    schoolOfOrigin: "SD Negeri 1 Samarinda",
    guardianName: "Budi",
    guardianRelation: "FATHER",
    guardianPhone: "081234567890",
  };
  const parsed = (changes: Partial<typeof typed>) =>
    ApplicantProfile.safeParse({ ...typed, ...changes });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00.30 on 2 December in Samarinda, still 1 December in UTC and in Jakarta.
    vi.setSystemTime("2026-12-01T16:30:00Z");
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["6472 0101 0101 0001", "6472010101010001"],
    ["6472.0101.0101.0001", "6472010101010001"],
    [" 6472\u00a00101.0101 0001\n", "6472010101010001"],
  ])("stores the NIK %j as 16 digits", (nik, stored) => {
    expect(parsed({ nik }).data?.nik).toBe(stored);
  });

  it.each([
    ["647201010101000", /harus 16 angka.*15 angka/],
    ["64720101010100012", /harus 16 angka.*17 angka/],
    ["647201010101000A", /hanya berisi angka/],
    ["٦٤٧٢٠١٠١٠١٠١٠٠٠١", /hanya berisi angka/],
    ["  ", /Isi NIK/],
  ])("refuses the NIK %j and says why", (nik, message) => {
    const result = parsed({ nik });
    expect(result.error?.issues).toMatchObject([
      { path: ["nik"], message: expect.stringMatching(message) },
    ]);
  });

  it.each([
    ["2018-12-02", true],
    ["2018-12-03", false],
    ["2000-12-03", true],
    ["2000-12-02", false],
    ["2012-02-29", true],
    ["2013-02-29", false],
    ["2014-13-01", false],
    ["2014-5-1", false],
    ["2027-01-01", false],
    ["0014-05-01", false],
  ])("decides a birth date of %s by the day in Samarinda: %s", (birthDate, accepted) => {
    const result = parsed({ birthDate });
    expect(result.success).toBe(accepted);
    if (!accepted) expect(result.error?.issues[0]?.path).toEqual(["birthDate"]);
  });

  it.each([
    ["081234567890", "+6281234567890"],
    ["0812 3456-7890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["+62 812.3456.7890", "+6281234567890"],
    ["+62 (0) 812 3456 7890", "+6281234567890"],
    ["0062 812 3456 7890", "+6281234567890"],
    ["(0541) 739-123", "+62541739123"],
    ["+60 12-345 6789", "+60123456789"],
  ])("stores the phone %j as %s", (guardianPhone, stored) => {
    expect(parsed({ guardianPhone }).data?.guardianPhone).toBe(stored);
    expect(parsed({ guardianPhone: stored }).data?.guardianPhone).toBe(stored);
  });

  it.each(["81234567890", "0812", "0812345678901234", "nomor saya", "+0812345678", "0812+345678"])(
    "refuses the phone %j",
    (guardianPhone) => {
      expect(parsed({ guardianPhone }).error?.issues[0]?.path).toEqual(["guardianPhone"]);
    },
  );

  it("keeps a name in any script, as one clean line", () => {
    expect(parsed({ childFullName: "  Nur\tالهدى \u0000 A\u202e " }).data?.childFullName).toBe(
      "Nur الهدى A",
    );
    expect(parsed({ childFullName: "\u200b" }).success).toBe(false);
    expect(parsed({ guardianRelation: "Ayah" }).error?.issues[0]?.path).toEqual([
      "guardianRelation",
    ]);
  });
});
