import { fetchAccount } from "@mbs/api-client/auth";
import { queryOptions } from "@tanstack/react-query";

/** The signed-in account, or null. The sign-in screens write it, the guard reads it. */
export const accountQuery = queryOptions({ queryKey: ["account"], queryFn: fetchAccount });
