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

/**
 * Whether any school is taking applications right now.
 *
 * The umbrella asks this, and it cannot read one school's answer for all three:
 * the cycle's `status` is global, but `isEnabled` is that school's own settings
 * row, so a school joined-but-disabled still returns a cycle. Reading the first
 * school would disable the joint CTA while the table under it says two schools
 * are open.
 */
export const anySchoolOpen = (facts: readonly CycleFacts[]) =>
  facts.some((entry) => entry.state === "cycle" && isOpen(entry.cycle));

/**
 * What a family reads on the page for each document type the committee set.
 *
 * The list is closed in the database, so this map is exhaustive by type rather
 * than a lookup with a fallback: a new document type fails to compile here
 * instead of printing its own constant name to a parent.
 */
const DOCUMENT_LABEL: Record<PublicCycle["documents"][number]["type"], string> = {
  KARTU_KELUARGA: "Kartu Keluarga",
  AKTA_KELAHIRAN: "Akta kelahiran",
  KARTU_IDENTITAS_ANAK: "Kartu Identitas Anak (KIA)",
  IJAZAH: "Ijazah atau surat keterangan lulus",
};

/**
 * Splits the committee's requirements into the two lists the page prints.
 *
 * A type the school does not collect has no row at all, so anything here is
 * asked for; `required` only decides which of the two lists it lands in.
 */
export function splitDocuments(documents: PublicCycle["documents"]) {
  const label = (document: PublicCycle["documents"][number]) => DOCUMENT_LABEL[document.type];
  return {
    required: documents.filter((document) => document.required).map(label),
    optional: documents.filter((document) => !document.required).map(label),
  };
}
