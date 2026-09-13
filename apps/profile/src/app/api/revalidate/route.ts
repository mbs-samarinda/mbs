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
 * which owner and which route changed, and the saving — three cached reads,
 * refetched once — is not worth a second thing to keep in step.
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

  if (request.headers.get("x-revalidate-secret") !== config.revalidateSecret) {
    return Response.json({ revalidated: false }, { status: 401 });
  }

  // `max` rather than the deprecated one-argument form: it marks the data stale
  // and serves the existing page while the refetch runs, so a publish never
  // makes the next visitor wait for Strapi. The alternative blocks that request
  // on a cache miss, which is a worse trade for content that is already live.
  revalidateTag(CMS_TAG, "max");
  return Response.json({ revalidated: true, tag: CMS_TAG });
}
