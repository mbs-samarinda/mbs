import { defineConfig } from "vitest/config";

// The owner tests assert the hosts an apex resolves to, and the apex is read
// from the environment at import. Pinning it here keeps the suite answering the
// same way whether or not the shell that runs it has PROFILE_APEX set — a
// staging deploy sets it, and a red test there would be the environment, not
// the code. The tests that care about another apex stub it themselves.
export default defineConfig({
  test: { env: { PROFILE_APEX: "mbss.sch.id" } },
});
