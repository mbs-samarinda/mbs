import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import { expect, it } from "vitest";

async function freePort() {
  const probe = createServer().listen(0);
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

// In production Node is PID 1, where a signal nobody handles is ignored and
// Docker kills the process after its grace period. Outside a container an
// unhandled SIGTERM kills it instead, so a clean exit code is what proves the
// handler ran.
it("closes cleanly on SIGTERM", async () => {
  const port = await freePort();
  const server = spawn(process.execPath, ["src/server.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      PORT: String(port),
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
      BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
      BETTER_AUTH_URL: "http://localhost:3001",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      ADMIN_APP_URL: "http://localhost:5174",
      BOOTSTRAP_ADMIN_EMAIL: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(server, "exit");

  await new Promise<void>((resolve) => {
    server.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Server listening")) resolve();
    });
  });

  server.kill("SIGTERM");
  expect(await exited).toEqual([0, null]);
}, 20_000);
