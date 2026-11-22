import { APPLICATION_COMMANDS, SIGN_IN_CODE_TEMPLATE } from "@mbs/school-config";
import { describe, expect, it } from "vitest";

import { TRANSITIONS } from "../application/stages.ts";
import { TEMPLATES } from "./templates.ts";

const input = {
  childName: "Aisyah <Putri>",
  schoolKey: "smp",
  registrationNumber: "SMP-0042",
  reason: "Foto buram & terpotong.",
  appUrl: "https://admission.mbss.sch.id",
} as const;

const eventKeys = [
  ...new Set(APPLICATION_COMMANDS.flatMap((command) => TRANSITIONS[command].notification ?? [])),
];

describe("email templates", () => {
  it("has a template for every email the stage table names, and no others", () => {
    expect(Object.keys(TEMPLATES).toSorted()).toEqual(
      [...eventKeys, SIGN_IN_CODE_TEMPLATE].toSorted(),
    );
  });

  it.each(eventKeys)("renders %s with the number, the next step and the link", (key) => {
    const mail = TEMPLATES[key].render(input);
    expect(TEMPLATES[key].version).toBeGreaterThanOrEqual(1);
    expect(mail.subject).toContain("SMP-0042");
    for (const body of [mail.text, mail.html]) {
      expect(body).toMatch(/\bkamu\b/i);
      expect(body).toContain("orang tua/wali");
      expect(body).toContain("SMP-0042");
      expect(body).toContain("https://admission.mbss.sch.id");
    }
    // Names and reasons are typed by people, so the HTML escapes them.
    expect(mail.html).not.toContain("<Putri>");
    expect(mail.html).toContain("Aisyah &lt;Putri&gt;");
    expect(mail.text).not.toMatch(/insya|alhamdulillah|assalamu/i);
  });

  it("puts the code in the sign-in email and says how long it works", () => {
    const mail = TEMPLATES[SIGN_IN_CODE_TEMPLATE].render({ code: "482913", minutes: 5 });
    expect(mail.subject).toContain("482913");
    expect(mail.text).toContain("482913");
    expect(mail.text).toContain("5 menit");
    expect(mail.html).toContain("482913");
  });
});
