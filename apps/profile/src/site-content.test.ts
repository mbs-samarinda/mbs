import { SCHOOLS } from "@mbs/school-config";
import { describe, expect, it } from "vitest";

import { OWNERS } from "./owners.ts";
import { SITE_CONTENT } from "./site-content.ts";

describe("site content", () => {
  // The page map's standing rule: home, admission and contact stay reachable
  // however editors reorganise navigation. Today that means the placeholder
  // carries them; once the CMS owns navigation it is the same check, there.
  it.each(OWNERS)("keeps home, admission and contact in $key navigation", (owner) => {
    const paths = SITE_CONTENT[owner.key].nav.map((item) => item.href);
    expect(paths).toEqual(expect.arrayContaining(["/", "/pendaftaran", "/kontak"]));
  });

  // The three school entries are built from positions in `SCHOOLS`, and the
  // record type cannot tell whether a position matches its key. Reordering that
  // constant would put one school's name and email on another school's host.
  it.each(SCHOOLS)("describes the school it is keyed by, for $key", (school) => {
    expect(SITE_CONTENT[school.key].copyright).toContain(school.name);
    expect(SITE_CONTENT[school.key].contacts.at(-1)?.value).toBe(
      `halo@${school.subdomain}.mbss.sch.id`,
    );
  });

  // The umbrella runs one campaign across three schools; it does not take
  // applications of its own, and its entry label says so.
  it("names the joint campaign on the umbrella and a start on a school", () => {
    expect(SITE_CONTENT.mbs.admissionCta).toBe("Pendaftaran Bersama");
    expect(SITE_CONTENT.smk.admissionCta).toBe("Mulai Pendaftaran");
  });

  it("gives the umbrella promise to the umbrella alone", () => {
    expect(SITE_CONTENT.mbs.tagline).toContain("Generasi Qur'ani");
    for (const key of ["smp", "smk", "sma"] as const) {
      expect(SITE_CONTENT[key].tagline).toBeNull();
    }
  });

  it("points the umbrella's school links at each school's own host", () => {
    const [schools] = SITE_CONTENT.mbs.footerColumns;
    expect(schools?.items.map((item) => item.href)).toEqual([
      "https://smp.mbss.sch.id/",
      "https://smk.mbss.sch.id/",
      "https://sma.mbss.sch.id/",
    ]);
  });
});
