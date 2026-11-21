import { join } from "node:path";

import type { NextConfig } from "next";

// Images come from Strapi, on its own host. Without this, the first logo or
// photograph an editor uploads throws "hostname is not configured" and 500s the
// page — and nothing catches it earlier, because a site with no media at all
// renders the placeholder slots and looks fine.
// `||` and not `??`: an empty `CMS_URL=` in a copied .env is the common case,
// and `new URL("")` throws here at config load, before the env module can say
// anything useful about it.
//
// This is read at BUILD time while `cms/client.ts` builds the image `src` at request
// time. A deploy that builds and serves with different values gets exactly the
// "hostname is not configured" failure this exists to prevent, so `CMS_URL`
// belongs in the build environment as well as the runtime one.
const cms = new URL(process.env.CMS_URL || "http://localhost:1337");

// Once media lives in S3, Strapi returns absolute URLs on the bucket's host and
// `cms/client.ts`'s `mediaUrl` passes them straight through — so the CMS host above no
// longer covers them and every photograph 500s with "hostname is not
// configured". Same value as the CMS's own AWS_BASE_URL.
//
// Optional: unset means the filesystem provider, media on the CMS host, and the
// single pattern below is enough. That is local development.
const mediaBase = process.env.MEDIA_BASE_URL ? new URL(process.env.MEDIA_BASE_URL) : null;

const remote = (url: URL, pathname: string) => ({
  protocol: url.protocol === "https:" ? ("https" as const) : ("http" as const),
  hostname: url.hostname,
  port: url.port,
  pathname,
});

const config: NextConfig = {
  // The image ships this folder and nothing else. Without it the runtime stage
  // needs the whole workspace `node_modules`, which on pnpm is a tree of
  // symlinks that does not survive a `COPY` into a thin image.
  output: "standalone",
  images: {
    // Next 16 refuses to optimize images from local addresses, so Strapi's
    // uploads on localhost broke every photo in development. Production media
    // sits on S3's public host, so the guard against fetching internal
    // addresses stays on there. A local `next start` against a local CMS still
    // shows broken photos.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
    remotePatterns: [
      remote(cms, "/uploads/**"),
      // The bucket path, not /uploads/**: the S3 provider keys objects at the
      // root of the bucket.
      ...(mediaBase ? [remote(mediaBase, `${mediaBase.pathname.replace(/\/$/, "")}/**`)] : []),
    ],
  },
  // One application serves every school subdomain. The hostname resolves to a
  // school key, which is also part of the cache key so two schools never share
  // a cached page for the same path.
  cacheComponents: true,
  // A `<Link>` fetches only the destination's shared shell ahead of the click,
  // one per route however many links point at it, not each page in full. The
  // next major turns this on everywhere and removes the option.
  partialPrefetching: true,
  // Every CMS read in `src/cms/`. Like the built-in "hours" profile, but `expire`
  // is a year, not a day: past `expire` an entry is a miss, so a Strapi outage
  // over a day turned every page into a 500. Past `revalidate`, or after a
  // publish, the old entry is served while a background refill runs, and a
  // failed refill leaves it (`cache-handler.ts`).
  cacheLife: {
    content: { stale: 5 * 60, revalidate: 60 * 60, expire: 365 * 24 * 60 * 60 },
  },
  // The `"use cache"` store, on a compose volume rather than in memory. Next's
  // own default handler is memory-backed, so every deploy and restart
  // started cold and the first visitor to each page waited on Strapi. With this
  // the replacement container reads what its predecessor wrote.
  cacheHandlers: {
    default: join(import.meta.dirname, "cache-handler.ts"),
  },
  // The root layout lives inside `[owner]`, so an unmatched path has no layout
  // to render a `not-found.tsx` in. This file convention answers those from
  // outside the tree instead.
  experimental: {
    globalNotFound: true,
    // Lets `e2e/` hold a page at its instant UI. The e2e job builds with this
    // set and calls `next build` directly: turbo passes only the variables
    // listed in turbo.json, so a turbo build, the one images ship, never has it.
    exposeTestingApiInProductionBuild: process.env.EXPOSE_TESTING_API === "1",
  },
  poweredByHeader: false,
  // A baseline, not a script allow-list. A strict `script-src` needs a nonce on
  // every one of Next's inline scripts, which ties every page to per-request
  // rendering for good; editors cannot inject a script anyway (`prose.tsx`).
  // HSTS is Caddy's, because only Caddy knows the request came over HTTPS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
