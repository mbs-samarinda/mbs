import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need the docker-compose database and run separately.
    exclude: process.env.INTEGRATION ? [] : ["src/**/*.integration.test.ts"],
  },
});
