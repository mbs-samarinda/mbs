import type { NextConfig } from "next";

const config: NextConfig = {
  // One application serves every school subdomain. The hostname resolves to a
  // school key, which is also part of the cache key so two schools never share
  // a cached page for the same path.
  cacheComponents: true,
};

export default config;
