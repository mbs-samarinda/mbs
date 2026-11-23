import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { environment: "jsdom", setupFiles: "./test/setup.ts", testTimeout: 30_000 },
  }),
);
