// Type-only: the contract carries every Zod schema, and none of it belongs in
// the browser bundle.
import type { contract } from "@mbs/api-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";

import { apiFetch } from "./http.ts";

export { ORPCError, safe } from "@orpc/client";

/** Same-origin. Caddy in production and Vite in development send /api to the API. */
export function createApiClient(): ContractRouterClient<typeof contract> {
  return createORPCClient(
    new RPCLink({
      url: `${location.origin}/api/rpc`,
      fetch: (request, init) => apiFetch(request, { ...init, signal: request.signal }),
    }),
  );
}
