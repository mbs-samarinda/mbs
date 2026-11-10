import { createHash, timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { CMS_TAG } from "../../../cms.ts";
import { config } from "../../../config/env.ts";

/**
 * What the CMS calls when an editor publishes.
 *
 * Without it the pages are correct but late: content reads are cached for
 * hours, so a notice published this morning would appear this afternoon. That
 * is the failure mode this whole product is built against, arriving by a
 * slower route.
 *
 * One tag for every content read. Finer invalidation would need the CMS to say
 * which owner and which route changed, and the saving, a handful of cached
 * reads refetched once per publish, is not worth a second thing to keep in step.
 *
 * This route belongs to no owner, which is why the proxy skips `api/`. It is
 * dynamic by nature and never prerendered.
 */
export async function POST(request: Request) {
  // Unset means the deployment never wired the CMS up. Refusing is the safe
  // reading: the alternative is an open endpoint that lets anyone dump the
  // cache of every site.
  if (!config.revalidateSecret) {
    return Response.json({ revalidated: false, reason: "not configured" }, { status: 503 });
  }

  if (!sameSecret(request.headers.get("x-revalidate-secret") ?? "", config.revalidateSecret)) {
    return Response.json({ revalidated: false }, { status: 401 });
  }

  // `max` rather than the deprecated one-argument form. Next's own handler
  // would then serve the old page while the refetch runs, but `cache-handler.ts`
  // ignores the profile and treats any revalidated tag as a miss, so the next
  // visitor to each page waits on Strapi once.
  revalidateTag(CMS_TAG, "max");
  return Response.json({ revalidated: true, tag: CMS_TAG });
}

/**
 * A constant-time compare, so response timing does not leak how much of the
 * secret a guess got right. Hashed first because `timingSafeEqual` throws on
 * inputs of different lengths, which would turn a short guess into a 500.
 */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();
