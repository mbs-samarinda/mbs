import { connect } from "node:net";

import { makeSignature } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.ts";
import { STAFF_HOST, testConfig } from "./test/config.ts";

// Runs against the real database from docker-compose, per the testing strategy:
// no mocked Drizzle, no second imaginary database.
const config = testConfig();

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

describe("request log", () => {
  it.each([
    ["GET", "/api/auth/callback/google"],
    ["PUT", "/api/auth/callback/google"],
    ["GET", "/no-such-route"],
    ["GET", "/%"],
  ] as const)("keeps the query string of %s %s out of the log", async (method, path) => {
    const lines: string[] = [];
    const watched = await buildApp(
      { ...config, logLevel: "debug" },
      { logStream: { write: (line) => void lines.push(line) } },
    );

    const response = await watched.inject({
      method,
      url: `${path}?code=one-time-code&state=s1`,
      headers: { host: STAFF_HOST },
    });
    await watched.close();

    expect(lines.join("")).not.toContain("one-time-code");
    expect(response.body).not.toContain("one-time-code");
    if (path !== "/%") expect(lines.join("")).toContain(`"url":"${path}"`);
  });

  it("keeps the raw bytes of a malformed request out of the log", async () => {
    const lines: string[] = [];
    const watched = await buildApp(
      { ...config, logLevel: "trace" },
      { logStream: { write: (line) => void lines.push(line) } },
    );
    await watched.listen({ port: 0, host: "127.0.0.1" });
    const address = watched.server.address();
    if (typeof address !== "object" || !address) throw new Error("the API has no port");

    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, "127.0.0.1", () =>
        socket.write("GET /api/auth/callback?code=one-time-code HTTP/1.1\r\nbad header\r\n\r\n"),
      );
      let received = "";
      socket.on("data", (chunk) => (received += chunk));
      socket.on("close", () => resolve(received));
      socket.on("error", reject);
    });
    await watched.close();

    expect(answer).toMatch(/^HTTP\/1\.1 400 /);
    expect(lines.join("")).toContain("client error");
    expect(lines.join("")).not.toContain("rawPacket");
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
    const auth = await watched.auth.STAFF.$context;
    const signature = await makeSignature(token, auth.secret);
    await watched.db.execute(sql`alter table session rename to session_away`);
    try {
      const response = await watched.inject({
        method,
        url,
        headers: {
          host: STAFF_HOST,
          "content-type": "application/json",
          cookie: `${auth.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
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

  it("keeps the status of a client error thrown outside oRPC", async () => {
    const { watched, logged } = await buildWatchedApp((target) => {
      target.get("/missing", () => {
        throw Object.assign(new Error("no such thing"), { status: 404 });
      });
    });

    const response = await watched.inject({ method: "GET", url: "/missing" });
    await watched.close();

    expect(response.statusCode).toBe(404);
    expect(logged).toEqual([]);
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
    const auth = await app.auth.STAFF.$context;
    await expect(
      auth.internalAdapter.createOAuthUser(
        { email: "stranger@gmail.com", name: "Stranger", emailVerified: true },
        { providerId: "google", accountId: "google-stranger" },
      ),
    ).rejects.toMatchObject({ body: { code: "account_not_approved" } });
  });
});
