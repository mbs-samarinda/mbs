import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.ts";

const valid = { DATABASE_URL: "postgres://user:pass@localhost:5432/mbs_core" };

describe("loadConfig", () => {
  it("applies defaults when only the required values are present", () => {
    const config = loadConfig(valid);
    expect(config.env).toBe("development");
    expect(config.port).toBe(3000);
    expect(config.secureCookies).toBe(false);
  });

  it("turns on secure cookies in production", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).secureCookies).toBe(true);
  });

  it("refuses to start without a database url", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
