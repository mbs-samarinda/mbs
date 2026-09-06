import { contract } from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { implement } from "@orpc/server";

export type ApiContext = {
  db: Database;
};

/** The contract-first implementer every procedure is built from. */
export const os = implement(contract).$context<ApiContext>();
