import type { FamilyApplication, PublicAdmissionCycle } from "@mbs/api-contract";
import { SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { createAppRouter, createQueryClient } from "../src/router.tsx";

/** `lost` is a request whose answer never arrives. */
export type Answer = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  lost?: boolean;
};
type Answers = Answer[] | ((schoolKey: SchoolKey) => Answer);

export const ACCOUNT = { id: "family-a", email: "wali@example.test" };

/**
 * Answers each auth path, such as `/get-session`, and each procedure, such as
 * `applicant/applications/list`, in turn; the last answer repeats. A path with
 * no answer fails as a dead network does.
 */
export function stubApi(answers: Record<string, Answers>, serverClock?: string) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string | Request, init: RequestInit = {}) => {
    const isRpc = typeof input !== "string";
    const path = isRpc
      ? new URL(input.url).pathname.replace("/api/rpc/", "")
      : input.replace("/api/auth", "");
    const sent: unknown = isRpc
      ? await input.json().catch(() => undefined)
      : typeof init.body === "string"
        ? JSON.parse(init.body)
        : undefined;
    const body = isRpc ? Reflect.get(Object(sent), "json") : sent;
    calls.push({ path, body });

    const queue = answers[path];
    const answer =
      typeof queue === "function"
        ? queue(SCHOOL_KEYS.find((key) => key === Reflect.get(Object(body), "schoolKey"))!)
        : queue && queue.length > 1
          ? queue.shift()
          : queue?.[0];
    if (!answer || answer.lost) throw new TypeError("Failed to fetch");
    return Response.json(isRpc ? { json: answer.body } : (answer.body ?? null), {
      status: answer.status ?? 200,
      headers: {
        "x-request-id": "1",
        date: (serverClock ? new Date(serverClock) : new Date()).toUTCString(),
        ...answer.headers,
      },
    });
  });
  return calls;
}

const DECLARED = ["REGISTRATION_CLOSED", "DUPLICATE_APPLICATION", "IDEMPOTENCY_KEY_REUSED"];

/** A procedure's refusal, as oRPC sends it. Only a declared code is marked defined. */
export function refusal(code: string, status: number, data?: unknown): Answer {
  return { status, body: { defined: DECLARED.includes(code), code, status, message: code, data } };
}

export function open(path: string | string[]) {
  const queryClient = createQueryClient();
  const initialEntries = typeof path === "string" ? [path] : path;
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return Object.assign(router, { unmount: view.unmount });
}

export function cycleOf(
  schoolKey: SchoolKey,
  changes: Partial<PublicAdmissionCycle> = {},
): PublicAdmissionCycle {
  return {
    id: "00000000-0000-4000-8000-00000000c1c1",
    name: "PPDB 2027/2028",
    status: "OPEN",
    registrationOpenAt: "2026-01-01T00:00:00.000Z",
    registrationCloseAt: "2099-03-31T15:59:00.000Z",
    resultPublishAt: "2099-05-01T00:00:00.000Z",
    schoolKey,
    isEnabled: true,
    effectiveFee: 250_000,
    documents: [],
    ...changes,
  };
}

export const SIGNED_IN = { "/get-session": [{ body: { user: ACCOUNT } }] };
export const CYCLES = "public/admission/getCurrentCycle";
export const LIST = "applicant/applications/list";
export const GET = "applicant/applications/get";
export const SUBMIT = "applicant/applications/submit";

export const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

export function applicationOf(changes: Partial<FamilyApplication> = {}): FamilyApplication {
  return {
    id: APPLICATION_ID,
    registrationNumber: "SMP-0042",
    schoolKey: "smp",
    childName: "Aisyah Putri",
    stage: "PAYMENT_DUE",
    registrationFee: 250_000,
    documents: [],
    resultPublishAt: "2099-05-01T00:00:00.000Z",
    events: [{ command: "SUBMIT", at: "2026-12-02T11:42:00.000Z", actor: "FAMILY", reason: null }],
    ...changes,
  };
}

/** A signed-in family with every school open and no applications. */
export const READY = {
  ...SIGNED_IN,
  [CYCLES]: (schoolKey: SchoolKey) => ({ body: cycleOf(schoolKey) }),
  [LIST]: [{ body: [] }],
  [GET]: [{ body: applicationOf() }],
  [SUBMIT]: [{ body: { applicationId: APPLICATION_ID } }],
};
