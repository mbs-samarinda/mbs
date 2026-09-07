import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
