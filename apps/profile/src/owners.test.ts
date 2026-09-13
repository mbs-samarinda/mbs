import { afterEach, expect, test, vi } from "vitest";

import { ownerFromHostname, ownerHost, OWNERS, ownerUrl } from "./owners.ts";

test("the apex is the umbrella", () => {
  expect(ownerFromHostname("mbss.sch.id")?.key).toBe("mbs");
  expect(ownerFromHostname("www.mbss.sch.id")?.key).toBe("mbs");
  expect(ownerFromHostname("mbss.sch.id:3002")?.key).toBe("mbs");
});

test("a known school label is that school", () => {
  expect(ownerFromHostname("sma.mbss.sch.id")?.key).toBe("sma");
  expect(ownerFromHostname("SMK.mbss.sch.id")?.key).toBe("smk");
});

test("localhost resolves the same way so the app runs locally", () => {
  expect(ownerFromHostname("localhost:3002")?.key).toBe("mbs");
  expect(ownerFromHostname("smk.localhost:3002")?.key).toBe("smk");
});

test("the public host of each owner", () => {
  expect(OWNERS.map(ownerHost)).toEqual([
    "mbss.sch.id",
    "smp.mbss.sch.id",
    "smk.mbss.sch.id",
    "sma.mbss.sch.id",
  ]);
});

test("each owner's site has an absolute URL, because the hosts differ", () => {
  expect(OWNERS.map(ownerUrl)).toEqual([
    "https://mbss.sch.id/",
    "https://smp.mbss.sch.id/",
    "https://smk.mbss.sch.id/",
    "https://sma.mbss.sch.id/",
  ]);
});

test("a local apex keeps the switcher on this machine", async () => {
  // https://smk.localhost/ is not reachable and not served on the dev port, so
  // the scheme and port have to follow the apex or the switcher leaves the
  // machine — on a developer's laptop, straight to the live site.
  vi.stubEnv("PROFILE_APEX", "localhost");
  vi.resetModules();
  const local = await import("./owners.ts");

  expect(local.OWNERS.map(local.ownerUrl)).toEqual([
    "http://localhost:3002/",
    "http://smp.localhost:3002/",
    "http://smk.localhost:3002/",
    "http://sma.localhost:3002/",
  ]);
});

// In the test above, not after it: a failed assertion would skip a cleanup
// written as the last statement and leave the apex stubbed for the rest of the
// file.
afterEach(() => {
  vi.unstubAllEnvs();
});

test("no other host resolves to an owner", () => {
  // The failure this guards is serving one owner's content under another
  // owner's hostname, so an unknown host has to be nobody rather than a
  // fallback to the umbrella.
  for (const host of [
    "sd.mbss.sch.id",
    "mbss.sch.id.evil.test",
    "smp.example.com",
    "sd.localhost",
    "",
  ]) {
    expect(ownerFromHostname(host), host).toBeNull();
  }
});

test("there are four owners and only the umbrella has no subdomain", () => {
  expect(OWNERS.map((owner) => owner.key)).toEqual(["mbs", "smp", "smk", "sma"]);
  expect(OWNERS.filter((owner) => owner.subdomain === null)).toHaveLength(1);
});
