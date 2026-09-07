import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need the docker-compose database and run separately.
    exclude: process.env.INTEGRATION ? [] : ["src/**/*.integration.test.ts"],
    // One database, one writer. Files that truncate shared tables cannot run
    // beside each other.
    fileParallelism: !process.env.INTEGRATION,
  },
});
