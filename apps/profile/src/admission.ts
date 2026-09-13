import type { contract } from "@mbs/api-contract";
import type { SchoolKey } from "@mbs/school-config";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { cache } from "react";

import { config } from "./config/env.ts";

// Type-only import of the contract: it carries every Zod schema, and none of
// that belongs in a page bundle. Nothing here uses it at runtime.
//
// Unlike the two Vite apps, this client runs on the server, where there is no
// `window.location.origin` to be same-origin with. It gets the API's address
// from the environment instead.
const link = new RPCLink({ url: `${config.apiBaseUrl}/api/rpc` });

const client: ContractRouterClient<typeof contract> = createORPCClient(link);

/** What a page renders for one school's admission cycle. */
export type CycleFacts =
  | { readonly state: "cycle"; readonly cycle: PublicCycle }
  | { readonly state: "none" }
  | { readonly state: "unavailable" };

type PublicCycle = NonNullable<Awaited<ReturnType<typeof client.public.admission.getCurrentCycle>>>;

/**
 * The one call the profile sites make for admission facts.
 *
 * This is never cached. A cached open/closed state is the exact failure this
 * product was designed against — the previous SMK site still tells parents a
 * 2026/2027 intake is open on a page last touched in October 2025. Callers wrap
 * it in `<Suspense>`, so the rest of the page still prerenders.
 *
 * A failure returns `unavailable` rather than throwing. A page that cannot read
 * the cycle still shows its content and the safe paths — the admission app and
 * the committee's contact — and never guesses a date.
 *
 * `cache` deduplicates it within one render. A home page asks three times — the
 * hero badge, the hero fact strip and the band — and oRPC posts, which Next
 * does not memoize on its own. Without this it is three round trips, and a
 * status flipped mid-render would print "dibuka" in the hero above "ditutup" in
 * the band.
 */
export const getCycleFacts = cache(async (schoolKey: SchoolKey): Promise<CycleFacts> => {
  try {
    const cycle = await client.public.admission.getCurrentCycle({ schoolKey });
    return cycle ? { state: "cycle", cycle } : { state: "none" };
  } catch {
    return { state: "unavailable" };
  }
});

/** Registration is open when the committee says so, not when a date looks right. */
export const isOpen = (cycle: PublicCycle) => cycle.status === "OPEN" && cycle.isEnabled;
