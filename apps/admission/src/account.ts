import { fetchAccount } from "@mbs/api-client/auth";
import { queryOptions } from "@tanstack/react-query";

export const accountQuery = queryOptions({ queryKey: ["account"], queryFn: fetchAccount });
