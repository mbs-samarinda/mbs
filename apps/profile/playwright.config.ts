import { defineConfig } from "@playwright/test";

// Runs against a production build made with EXPOSE_TESTING_API=1, reading a
// CMS on CMS_URL; the e2e job in .github/workflows/ci.yml sets both up. A
// production build because that is what visitors get, and what the test was
// shown to fail against. `next start` warns about the standalone output the
// image runs; that difference does not touch navigation.
const port = process.env.PROFILE_PORT ?? "3002";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  // The owner comes from the host, so this base URL is the SMP site.
  use: { baseURL: `http://smp.localhost:${port}` },
  webServer: {
    command: `next start --port ${port}`,
    url: `http://smp.localhost:${port}`,
    env: { PROFILE_APEX: "localhost" },
  },
});
