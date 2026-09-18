import type { NextConfig } from "next";

// Images come from Strapi, on its own host. Without this, the first logo or
// photograph an editor uploads throws "hostname is not configured" and 500s the
// page — and nothing catches it earlier, because a site with no media at all
// renders the placeholder slots and looks fine.
// `||` and not `??`: an empty `CMS_URL=` in a copied .env is the common case,
// and `new URL("")` throws here at config load, before the env module can say
// anything useful about it.
//
// This is read at BUILD time while `cms.ts` builds the image `src` at request
// time. A deploy that builds and serves with different values gets exactly the
// "hostname is not configured" failure this exists to prevent, so `CMS_URL`
// belongs in the build environment — the same rule `owners.ts` states for
// `PROFILE_APEX`.
const cms = new URL(process.env.CMS_URL || "http://localhost:1337");

// Once media lives in S3, Strapi returns absolute URLs on the bucket's host and
// `cms.ts`'s `mediaUrl` passes them straight through — so the CMS host above no
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
  // The root layout lives inside `[owner]`, so an unmatched path has no layout
  // to render a `not-found.tsx` in. This file convention answers those from
  // outside the tree instead.
  experimental: { globalNotFound: true },
};

export default config;
