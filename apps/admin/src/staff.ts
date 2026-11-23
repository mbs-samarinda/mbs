import { fetchAccount } from "@mbs/api-client/auth";
import { createApiClient, ORPCError } from "@mbs/api-client/rpc";
import { queryOptions } from "@tanstack/react-query";

const api = createApiClient();

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
