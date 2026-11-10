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

// Unhandled, SIGTERM kills the process by signal; exit code 0 proves the
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

  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      server.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Server listening")) resolve();
      });
      server.once("exit", (code) => reject(new Error(`server exited early with ${code}`)));
    });

    server.kill("SIGTERM");
    expect(await exited).toEqual([0, null]);
  } finally {
    server.kill("SIGKILL");
  }
}, 20_000);
