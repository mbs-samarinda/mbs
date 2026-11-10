import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import { createDatabase } from "@mbs/db";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";

async function freePort() {
  const probe = createServer().listen(0);
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core";

function startServer(port: number) {
  return spawn(process.execPath, ["src/server.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
      BETTER_AUTH_URL: "http://localhost:3001",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      ADMIN_APP_URL: "http://localhost:5174",
      BOOTSTRAP_ADMIN_EMAIL: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// Unhandled, SIGTERM kills the process by signal; exit code 0 proves the
// handler ran.
it("closes cleanly on SIGTERM", async () => {
  const server = startServer(await freePort());
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

it("never starts listening once SIGTERM arrived during startup", async () => {
  const db = createDatabase(databaseUrl);
  let output = "";
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  // Holding this lock parks the server inside its startup schools check.
  const holder = db.transaction(async (tx) => {
    await tx.execute(sql`lock table schools in access exclusive mode`);
    await released;
  });
  const server = startServer(await freePort());
  server.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(server, "exit");

  try {
    for (let waited = 0; ; waited += 50) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const [row] = await db.execute<{ waiting: number }>(
        sql`select count(*)::int as waiting from pg_locks where not granted and relation = 'schools'::regclass`,
      );
      if (row?.waiting) break;
      if (waited > 10_000) throw new Error("server never reached the schools check");
      // oxlint-disable-next-line eslint/no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;

    expect(await exited).toEqual([0, null]);
    expect(output).not.toContain("Server listening");
  } finally {
    release();
    server.kill("SIGKILL");
    await db.$client.end();
  }
}, 20_000);
