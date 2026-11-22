import { createHash } from "node:crypto";

import { APPLICATION_COMMANDS, SIGN_IN_CODE_TEMPLATE } from "@mbs/school-config";
import { describe, expect, it } from "vitest";

import { TRANSITIONS } from "../application/stages.ts";
import { TEMPLATES, type TemplateKey } from "./templates.ts";

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

const PINNED: { [K in TemplateKey]: { version: number; hash: string } } = {
  "application-submitted": { version: 1, hash: "73f5d6a234b4e2ba" },
  "payment-received": { version: 1, hash: "8d1cf43c981bbbb6" },
  "payment-approved": { version: 1, hash: "c54002f8cbc4b4ce" },
  "payment-rejected": { version: 1, hash: "b838c8e5d9071654" },
  "documents-received": { version: 1, hash: "345715a4f26237e9" },
  "documents-need-fix": { version: 1, hash: "dc8a487d25c0704b" },
  "documents-verified": { version: 1, hash: "a8e7cd6f0a4f78a8" },
  "advanced-to-interview": { version: 1, hash: "68471f50f501bcc1" },
  "stopped-at-screening": { version: 1, hash: "e90078fa6a092421" },
  "interview-scheduled": { version: 1, hash: "2ad503cf653cf032" },
  "interview-rescheduled": { version: 1, hash: "93c82cc6ad88fca5" },
  "interview-missed": { version: 1, hash: "a102b1aade18141c" },
  "result-accepted": { version: 1, hash: "6824d37b63b4b9cc" },
  "result-not-accepted": { version: 1, hash: "1cc461b1c3a2af6a" },
  "reregistration-received": { version: 1, hash: "4e51db100318dc51" },
  "reregistration-needs-fix": { version: 1, hash: "dad93bb85a7be8dd" },
  enrolled: { version: 1, hash: "b2d16559df759995" },
  withdrawn: { version: 1, hash: "728abf90a7de6eb8" },
  [SIGN_IN_CODE_TEMPLATE]: { version: 1, hash: "d70cc2f420f8826e" },
};

function hashOf(key: TemplateKey) {
  const mail =
    key === SIGN_IN_CODE_TEMPLATE
      ? TEMPLATES[key].render({ code: "000000", minutes: 5 })
      : TEMPLATES[key].render(input);
  return createHash("sha256")
    .update(JSON.stringify([mail.subject, mail.text, mail.html]))
    .digest("hex")
    .slice(0, 16);
}

describe("template versions", () => {
  it.each<TemplateKey>([...eventKeys, SIGN_IN_CODE_TEMPLATE])(
    "pins the copy of %s to its version",
    (key) => {
      const actual = { version: TEMPLATES[key].version, hash: hashOf(key) };
      const pinned = PINNED[key];
      const message =
        actual.version === pinned.version
          ? `The copy of "${key}" changed. Bump its version in templates.ts to ${pinned.version + 1}, then pin { version: ${pinned.version + 1}, hash: "${actual.hash}" } here.`
          : `"${key}" is at version ${actual.version}. Pin { version: ${actual.version}, hash: "${actual.hash}" } here.`;
      expect(actual, message).toEqual(pinned);
    },
  );
});
