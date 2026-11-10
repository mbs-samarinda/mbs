import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";

// Runs against the real database from docker-compose, per the testing strategy:
// no mocked Drizzle, no second imaginary database.
const config = loadConfig({
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
  BETTER_AUTH_URL: "http://localhost:3001",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  ADMIN_APP_URL: "http://localhost:5174",
});

const app = await buildApp(config);

beforeAll(() => app.ready());
afterAll(() => app.close());

describe("api boundary", () => {
  it("reports ready when the database answers", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("serves the public cycle procedure through oRPC", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rpc/public/admission/getCurrentCycle",
      headers: { "content-type": "application/json" },
      payload: { json: { schoolKey: "sma" } },
    });
    expect(response.statusCode).toBe(200);
  });

  it("rejects a school key the contract does not allow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rpc/public/admission/getCurrentCycle",
      headers: { "content-type": "application/json" },
      payload: { json: { schoolKey: "not-a-school" } },
    });
    expect(response.statusCode).toBe(400);
  });
});

// Collects every error-level log line, with the request it belonged to.
async function buildWatchedApp(addRoutes?: (target: FastifyInstance) => void) {
  const watched = await buildApp(config);
  addRoutes?.(watched);
  const logged: { reqId: string; args: unknown[] }[] = [];
  watched.addHook("onRequest", async (request) => {
    vi.spyOn(request.log, "error").mockImplementation((...args: unknown[]) => {
      logged.push({ reqId: request.id, args });
    });
  });
  await watched.ready();
  return { watched, logged };
}

function getCurrentCycle(target: FastifyInstance, schoolKey: string) {
  return target.inject({
    method: "POST",
    url: "/api/rpc/public/admission/getCurrentCycle",
    headers: { "content-type": "application/json" },
    payload: { json: { schoolKey } },
  });
}

describe("unexpected errors", () => {
  it("logs the failure with the request id and answers a generic 500", async () => {
    const { watched, logged } = await buildWatchedApp();
    await watched.db.$client.end();

    const response = await getCurrentCycle(watched, "sma");
    await watched.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ json: { code: "INTERNAL_SERVER_ERROR" } });
    expect(response.body).not.toMatch(/connection/i);
    expect(logged).toHaveLength(1);
    expect(response.headers["x-request-id"]).toBe(logged[0]?.reqId);
  });

  // Query parameters can be staff or applicant emails, which must not reach the logs.
  it("logs a failed query without its parameters", async () => {
    const { watched, logged } = await buildWatchedApp();
    await watched.db.execute(sql`alter table school_admission_settings rename to settings_away`);
    try {
      const response = await getCurrentCycle(watched, "sma");
      expect(response.statusCode).toBe(500);
    } finally {
      await watched.db.execute(sql`alter table settings_away rename to school_admission_settings`);
      await watched.close();
    }

    expect(logged).toHaveLength(1);
    const line = JSON.stringify(logged[0]?.args);
    expect(line).toContain("42P01");
    expect(line).not.toContain("CLOSED");
  });

  // The session lookup runs before oRPC and Better Auth logs its own failures,
  // so these paths never pass the procedure interceptor.
  it.each([
    { method: "POST" as const, url: "/api/rpc/public/admission/getCurrentCycle" },
    { method: "GET" as const, url: "/api/auth/get-session" },
  ])("logs a failed session lookup on $url without its parameters", async ({ method, url }) => {
    const { watched, logged } = await buildWatchedApp();
    const printed: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void printed.push(args));
    vi.spyOn(console, "warn").mockImplementation((...args) => void printed.push(args));
    vi.spyOn(watched.log, "error").mockImplementation(
      (...args: unknown[]) => void printed.push(args),
    );
    const token = "session-token-that-must-not-be-logged";
    const signature = createHmac("sha256", config.auth.secret).update(token).digest("base64");
    await watched.db.execute(sql`alter table session rename to session_away`);
    try {
      const response = await watched.inject({
        method,
        url,
        headers: {
          "content-type": "application/json",
          cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
        },
        ...(method === "POST" ? { payload: { json: { schoolKey: "sma" } } } : {}),
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(token);
    } finally {
      vi.restoreAllMocks();
      await watched.db.execute(sql`alter table session_away rename to session`);
      await watched.close();
    }

    const lines = JSON.stringify([...printed, ...logged.map((entry) => entry.args)]);
    expect(lines).not.toContain(token);
    expect(lines).toContain("42P01");
  });

  it("answers a failed query outside oRPC with a generic 500 and a redacted log", async () => {
    const secret = "parameter-that-must-not-be-logged";
    const { watched, logged } = await buildWatchedApp((target) => {
      target.get("/failing-query", () =>
        target.db.execute(sql`select * from missing_table where x = ${secret}`),
      );
    });

    const response = await watched.inject({ method: "GET", url: "/failing-query" });
    await watched.close();

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain("missing_table");
    expect(logged).toHaveLength(1);
    expect(response.headers["x-request-id"]).toBe(logged[0]?.reqId);
    const line = JSON.stringify(logged[0]?.args);
    expect(line).toContain("42P01");
    expect(line).not.toContain(secret);
  });

  it("logs nothing at error level for a rejected request", async () => {
    const { watched, logged } = await buildWatchedApp();

    const response = await getCurrentCycle(watched, "not-a-school");
    const malformed = await watched.inject({
      method: "POST",
      url: "/api/rpc/public/admission/getCurrentCycle",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    await watched.close();

    expect(response.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(logged).toEqual([]);
  });
});

describe("sign-in gate", () => {
  // Better Auth turns this code into `?error=` on the committee app, which
  // shows its no-access line for this code only.
  it("refuses an unapproved address with the code the committee app expects", async () => {
    const auth = await app.auth.$context;
    await expect(
      auth.internalAdapter.createOAuthUser(
        { email: "stranger@gmail.com", name: "Stranger", emailVerified: true },
        { providerId: "google", accountId: "google-stranger" },
      ),
    ).rejects.toMatchObject({ body: { code: "account_not_approved" } });
  });
});
