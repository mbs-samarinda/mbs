import { fetchAccount } from "@mbs/api-client/auth";
import { createApiClient, ORPCError } from "@mbs/api-client/rpc";
import type { ListApplicationsInput, SchoolKey } from "@mbs/api-contract";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

export const api = createApiClient();

/** Signed in is not enough here: the API decides who is active staff, on every call. */
async function fetchVisitor() {
  const account = await fetchAccount();
  if (!account) return { kind: "signed-out" } as const;
  try {
    return { kind: "staff", staff: await api.staff.me.get() } as const;
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    if (error.code === "UNAUTHORIZED") return { kind: "signed-out" } as const;
    if (error.code !== "FORBIDDEN") throw error;
    return { kind: "refused", email: account.email } as const;
  }
}

export const visitorQuery = queryOptions({ queryKey: ["visitor"], queryFn: fetchVisitor });

// Sign-out clears the whole cache, so no key needs the staff id in it.

export const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => api.staff.dashboard.get(),
});

export const applicationsQuery = (input: ListApplicationsInput) =>
  queryOptions({
    queryKey: ["applications", "list", input],
    queryFn: () => api.staff.applications.list(input),
  });

export const applicationQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["applications", "one", applicationId],
    queryFn: () => api.staff.applications.get({ applicationId }),
  });

export const cyclesQuery = queryOptions({
  queryKey: ["cycles", "list"],
  queryFn: () => api.admin.cycles.list(),
});

export const cycleSetupQuery = (cycleId: string) =>
  queryOptions({
    queryKey: ["cycles", "one", cycleId],
    queryFn: () => api.admin.cycles.get({ cycleId }),
  });

export const agreementVersionsQuery = (schoolKey: SchoolKey) =>
  queryOptions({
    queryKey: ["agreements", schoolKey],
    queryFn: () => api.admin.agreements.list({ schoolKey }),
  });

export const staffListQuery = queryOptions({
  queryKey: ["staff"],
  queryFn: () => api.admin.staff.list(),
});

type Issue = { path: readonly PropertyKey[]; message: string; code?: string };

/**
 * Field errors keyed by path, such as `registrationCloseAt` or `schools.0.body`.
 * Only the contract's own sentences are shown; a generic check (too long, not a
 * number) gets one plain line rather than Zod's English.
 */
export function issuesByField(issues: readonly Issue[]) {
  const byField: Record<string, string> = {};
  for (const issue of issues) {
    byField[issue.path.map(String).join(".")] ??=
      issue.code === "custom" ? issue.message : "Periksa isian ini.";
  }
  return byField;
}

/** The API checks the same contract, so its refusal carries the same issues. */
export function serverIssues(error: unknown): Issue[] | null {
  if (!(error instanceof ORPCError) || error.code !== "BAD_REQUEST") return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("issues" in data)) return null;
  return Array.isArray(data.issues) ? data.issues.filter(isIssue) : null;
}

function isIssue(value: unknown): value is Issue {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    Array.isArray(value.path) &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export const waitingProofsQuery = infiniteQueryOptions({
  queryKey: ["payments", "waiting"],
  queryFn: ({ pageParam }) => api.staff.payments.listWaiting({ page: pageParam }),
  initialPageParam: 1,
  getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
});

export const proofQuery = (paymentId: string) =>
  queryOptions({
    queryKey: ["payments", "proof", paymentId],
    queryFn: () => api.staff.payments.open({ paymentId }),
    staleTime: 4 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
