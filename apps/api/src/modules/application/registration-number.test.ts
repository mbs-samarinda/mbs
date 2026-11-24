import { expect, it } from "vitest";

import { formatRegistrationNumber, parseRegistrationNumber } from "./registration-number.ts";

it.each([
  ["SMP-0042", "SMP-0042"],
  [" smp-0042 ", "SMP-0042"],
  ["Smp0042", "SMP-0042"],
  ["smp42", "SMP-0042"],
  ["SMA 42", "SMA-0042"],
  ["SMK–0007", "SMK-0007"],
  ["smp - 000042", "SMP-0042"],
  ["\u200eSMP-0042\u200b", "SMP-0042"],
  ["SMP-12345", "SMP-12345"],
])("reads %j as %s", (typed, number) => {
  expect(parseRegistrationNumber(typed)).toBe(number);
});

it.each([
  "",
  "SMP",
  "SMP-",
  "SMP-0000",
  "42",
  "MBS-0042",
  "SMP-0042x",
  "SMP-42-1",
  "6472010101010001",
  "SMP-6472010101010001",
  "SMP\u0000-0042",
])("does not read %j as a number", (typed) => {
  expect(parseRegistrationNumber(typed)).toBeNull();
});

it("reads every number it makes", () => {
  for (const seq of [1, 9, 9999, 10_000, 999_999]) {
    const number = formatRegistrationNumber("smk", seq);
    expect(parseRegistrationNumber(number)).toBe(number);
  }
});
