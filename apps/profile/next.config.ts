import type { NextConfig } from "next";

const config: NextConfig = {
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
