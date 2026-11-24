import type { CommitteeDashboard, StaffProfile } from "@mbs/api-contract";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { createAppRouter, createQueryClient } from "../src/router.tsx";

export type Answer = { status: number; body: unknown };

export const rpc = (status: number, code: string): Answer => ({
  status,
  body: { json: { defined: false, code, status, message: code } },
});
export const ok = (json: unknown): Answer => ({ status: 200, body: { json } });

export const ACCOUNT = "/api/auth/get-session";
export const ME = "/api/rpc/staff/me/get";
export const DASHBOARD = "/api/rpc/staff/dashboard/get";
export const LIST = "/api/rpc/staff/applications/list";

export const SIGNED_OUT: Answer = { status: 200, body: null };
export const SIGNED_IN: Answer = {
  status: 200,
  body: { user: { id: "staff", email: "wali@example.test" } },
};
export const STAFF = ok({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Siti Rahmah",
  role: "STAFF",
  schools: ["smp"],
  loginEmails: [],
} satisfies StaffProfile);

export const EMPTY_DASHBOARD: CommitteeDashboard = {
  cycle: { name: "PPDB 2027/2028", closesAt: "2099-01-31T08:00:00.000Z" },
  total: 0,
  newThisWeek: 0,
  paid: 0,
  needsCommittee: 0,
  oldestWaitingSince: null,
  accepted: 0,
  decided: 0,
  perSchool: [{ schoolKey: "smp", total: 0 }],
  recent: [],
};

/** Answers each API path with a fixed reply. A path with none fails like a network that is down. */
export function stubApi(answers: Record<string, Answer>) {
  vi.stubGlobal("fetch", async (input: string | Request) => {
    const url = new URL(input instanceof Request ? input.url : input, location.origin);
    const answer = answers[url.pathname];
    if (!answer) throw new TypeError("Failed to fetch");
    return Response.json(answer.body, {
      status: answer.status,
      headers: { "x-request-id": "1" },
    });
  });
}

export function open(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
