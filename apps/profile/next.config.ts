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

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: cms.protocol === "https:" ? "https" : "http",
        hostname: cms.hostname,
        port: cms.port,
        pathname: "/uploads/**",
      },
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
