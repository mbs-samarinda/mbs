import { ownerUrl, requireOwner } from "@/owners.ts";

/**
 * Each host's robots.txt, pointing at that host's own sitemap.
 *
 * A plain route rather than Next's `robots.ts`: that file is only recognised at
 * the root of `app`, where the proxy's per-owner rewrite never lands, and
 * reading the Host header there instead would take the owner out of the route
 * and so out of the cache key.
 */
export async function GET(_: Request, { params }: { params: Promise<{ owner: string }> }) {
  const owner = await requireOwner(params);
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${ownerUrl(owner)}sitemap-pages.xml\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
