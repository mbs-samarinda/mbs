import { describe, expect, it } from "vitest";

import { loadConfig } from "./env.ts";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/mbs_core",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3001",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  ADMIN_APP_URL: "http://localhost:5174",
};

describe("loadConfig", () => {
  it("applies defaults when only the required values are present", () => {
    const config = loadConfig(valid);
    expect(config.env).toBe("development");
    expect(config.port).toBe(3001);
    expect(config.isProduction).toBe(false);
  });

  it("knows when it is running in production", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).isProduction).toBe(true);
  });

  it("refuses to start without a database url", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("refuses to start without the auth secret", () => {
    const { BETTER_AUTH_SECRET: _secret, ...rest } = valid;
    expect(() => loadConfig(rest)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("refuses a secret short enough to brute force", () => {
    expect(() => loadConfig({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("treats a blank value as unset so the default still applies", () => {
    const config = loadConfig({ ...valid, PORT: "", LOG_LEVEL: "" });
    expect(config.port).toBe(3001);
    expect(config.logLevel).toBe("info");
  });

  it("leaves the bootstrap administrator unset when it is blank", () => {
    expect(loadConfig({ ...valid, BOOTSTRAP_ADMIN_EMAIL: "" }).bootstrapAdminEmail).toBeUndefined();
  });
});
