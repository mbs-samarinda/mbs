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
async function buildWatchedApp() {
  const watched = await buildApp(config);
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

  it("logs nothing at error level for a rejected request", async () => {
    const { watched, logged } = await buildWatchedApp();

    const response = await getCurrentCycle(watched, "not-a-school");
    await watched.close();

    expect(response.statusCode).toBe(400);
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
