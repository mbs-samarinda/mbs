import type { ActorType, ApplicationCommand, ApplicationStage } from "@mbs/api-contract";
import {
  ACTOR_TYPES,
  APPLICATION_COMMANDS,
  APPLICATION_STAGES,
  END_STAGES,
} from "@mbs/school-config";
import { describe, expect, it } from "vitest";

import { TRANSITIONS, familyStage, isEndStage, transition } from "./stages.ts";

const OPEN_STAGES = APPLICATION_STAGES.filter((stage) => !isEndStage(stage));

/**
 * The stage table from knowledge/docs/admission.md, written out by hand rather
 * than read from TRANSITIONS, so the test checks the code against the design
 * and not against itself.
 */
const DESIGN: [ApplicationStage | null, ApplicationCommand, ApplicationStage, ActorType[]][] = [
  [null, "SUBMIT", "PAYMENT_DUE", ["FAMILY"]],
  ["PAYMENT_DUE", "UPLOAD_PAYMENT_PROOF", "PAYMENT_REVIEW", ["FAMILY"]],
  ["PAYMENT_REVIEW", "APPROVE_PAYMENT", "DOCUMENTS_DUE", ["STAFF"]],
  ["PAYMENT_REVIEW", "REJECT_PAYMENT", "PAYMENT_DUE", ["STAFF"]],
  ["DOCUMENTS_DUE", "SUBMIT_DOCUMENTS", "DOCUMENTS_REVIEW", ["FAMILY"]],
  ["DOCUMENTS_REVIEW", "REQUEST_DOCUMENT_FIX", "DOCUMENTS_DUE", ["STAFF"]],
  ["DOCUMENTS_REVIEW", "VERIFY_DOCUMENTS", "SCREENING", ["STAFF"]],
  ["SCREENING", "ADVANCE_TO_INTERVIEW", "INTERVIEW_PENDING", ["STAFF"]],
  ["SCREENING", "STOP_AT_SCREENING", "NOT_ADVANCED", ["STAFF"]],
  ["INTERVIEW_PENDING", "SCHEDULE_INTERVIEW", "INTERVIEW_SCHEDULED", ["STAFF"]],
  ["INTERVIEW_SCHEDULED", "RESCHEDULE_INTERVIEW", "INTERVIEW_SCHEDULED", ["STAFF"]],
  ["INTERVIEW_SCHEDULED", "RECORD_ATTENDED", "INTERVIEWED", ["STAFF"]],
  ["INTERVIEW_SCHEDULED", "RECORD_NO_SHOW", "INTERVIEW_PENDING", ["STAFF"]],
  ["INTERVIEWED", "DECIDE", "DECIDED", ["STAFF"]],
  ["DECIDED", "DECIDE", "DECIDED", ["STAFF"]],
  ["DECIDED", "PUBLISH_ACCEPTED", "REREGISTRATION", ["SYSTEM"]],
  ["DECIDED", "PUBLISH_NOT_ACCEPTED", "NOT_ACCEPTED", ["SYSTEM"]],
  ["REREGISTRATION", "SUBMIT_REREGISTRATION", "REREGISTRATION_REVIEW", ["FAMILY"]],
  ["REREGISTRATION_REVIEW", "REQUEST_REREGISTRATION_FIX", "REREGISTRATION", ["STAFF"]],
  ["REREGISTRATION_REVIEW", "CONFIRM_ENROLLMENT", "ENROLLED", ["STAFF"]],
  ...OPEN_STAGES.map(
    (stage) =>
      [stage, "WITHDRAW", "WITHDRAWN", ["FAMILY", "STAFF"]] satisfies (typeof DESIGN)[number],
  ),
  ...OPEN_STAGES.map(
    (stage) => [stage, "ADD_NOTE", stage, ["STAFF"]] satisfies (typeof DESIGN)[number],
  ),
  ...OPEN_STAGES.map(
    (stage) =>
      [stage, "EDIT_PROFILE", stage, ["FAMILY", "STAFF"]] satisfies (typeof DESIGN)[number],
  ),
  ...(["DOCUMENTS_DUE", "DOCUMENTS_REVIEW", "SCREENING", "INTERVIEW_PENDING"] as const).map(
    (stage) =>
      [
        stage,
        "CHANGE_INTERVIEW_MODE",
        stage,
        ["FAMILY", "STAFF"],
      ] satisfies (typeof DESIGN)[number],
  ),
];

function designRow(stage: ApplicationStage | null, command: ApplicationCommand) {
  return DESIGN.find(([from, rowCommand]) => from === stage && rowCommand === command);
}

const EVERY_STAGE = [null, ...APPLICATION_STAGES];

/** Publishing announces a decision, so it needs the newest DECIDE to agree. */
const PUBLISHES = new Map<ApplicationCommand, "ACCEPTED" | "NOT_ACCEPTED">([
  ["PUBLISH_ACCEPTED", "ACCEPTED"],
  ["PUBLISH_NOT_ACCEPTED", "NOT_ACCEPTED"],
]);

function newestDecision(command: ApplicationCommand) {
  const decision = PUBLISHES.get(command);
  return decision && { payloadVersion: 1, decision };
}

describe("transition", () => {
  it.each(DESIGN)("%s + %s goes to %s for %j", (from, command, to, actors) => {
    for (const actor of actors) {
      expect(transition(from, command, actor, newestDecision(command))).toMatchObject({
        ok: true,
        to,
      });
    }
  });

  it.each([
    ["PUBLISH_ACCEPTED", "NOT_ACCEPTED"],
    ["PUBLISH_NOT_ACCEPTED", "ACCEPTED"],
  ] as const)("refuses %s when the newest decision is %s", (command, decision) => {
    expect(transition("DECIDED", command, "SYSTEM", { payloadVersion: 1, decision })).toEqual({
      ok: false,
      refusal: "REQUIREMENT_UNMET",
    });
  });

  it("refuses to publish before anything was decided", () => {
    expect(transition("DECIDED", "PUBLISH_ACCEPTED", "SYSTEM", null)).toEqual({
      ok: false,
      refusal: "REQUIREMENT_UNMET",
    });
  });

  it("refuses an actor the design does not name", () => {
    for (const [from, command, , actors] of DESIGN) {
      for (const actor of ACTOR_TYPES.filter((type) => !actors.includes(type))) {
        expect(transition(from, command, actor)).toEqual({
          ok: false,
          refusal: "ACTOR_NOT_ALLOWED",
        });
      }
    }
  });

  it("refuses every stage and command pair the design leaves out", () => {
    let refused = 0;
    for (const stage of EVERY_STAGE) {
      for (const command of APPLICATION_COMMANDS) {
        if (designRow(stage, command)) continue;
        for (const actor of ACTOR_TYPES) {
          expect(transition(stage, command, actor)).toEqual({
            ok: false,
            refusal: "ILLEGAL_STAGE",
          });
          refused += 1;
        }
      }
    }
    expect(refused).toBeGreaterThan(500);
  });

  it.each(END_STAGES)("lets nothing move an application out of %s", (stage) => {
    for (const command of APPLICATION_COMMANDS) {
      for (const actor of ACTOR_TYPES) {
        expect(transition(stage, command, actor).ok).toBe(false);
      }
    }
  });

  it("shows a family every stage but a decision, which reads as still waiting", () => {
    expect(APPLICATION_STAGES.filter((stage) => familyStage(stage) !== stage)).toEqual(["DECIDED"]);
    expect(familyStage("DECIDED")).toBe("INTERVIEWED");
  });

  it("keeps the decision from the family until it is published", () => {
    expect(transition("INTERVIEWED", "DECIDE", "STAFF")).toMatchObject({
      familyVisible: false,
      notification: null,
    });
    expect(
      transition("DECIDED", "PUBLISH_ACCEPTED", "SYSTEM", newestDecision("PUBLISH_ACCEPTED")),
    ).toMatchObject({
      familyVisible: true,
    });
  });

  it("keeps staff notes from the family", () => {
    expect(transition("SCREENING", "ADD_NOTE", "STAFF")).toMatchObject({ familyVisible: false });
  });

  it("emails the family on every stage change it can see", () => {
    const silent = Object.entries(TRANSITIONS)
      .filter(([, row]) => row.familyVisible && row.to !== "SAME" && row.notification === null)
      .map(([command]) => command);
    expect(silent).toEqual([]);
  });
});
