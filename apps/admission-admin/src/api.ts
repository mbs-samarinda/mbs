// Type-only: the contract carries every Zod schema, and none of it belongs
// in the browser bundle. Nothing here uses it at runtime.
import type { contract } from "@mbs/api-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

// Same-origin. Caddy in production and the Vite proxy in development both send
// /api to Fastify.
const link = new RPCLink({ url: `${window.location.origin}/api/rpc` });

export const client: ContractRouterClient<typeof contract> = createORPCClient(link);
export const api = createTanstackQueryUtils(client);
