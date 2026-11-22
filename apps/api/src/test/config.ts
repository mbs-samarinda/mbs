import { loadConfig } from "../config/env.ts";

/** The hosts the two apps serve in development, and so in tests. */
export const FAMILY_HOST = "localhost:5173";
export const STAFF_HOST = "localhost:5174";

/** One environment every suite starts from, so a new variable is added once. */
export const TEST_ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://mbs:mbs_local_dev@localhost:5432/mbs_core",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  FAMILY_APP_URL: `http://${FAMILY_HOST}`,
  ADMIN_APP_URL: `http://${STAFF_HOST}`,
  // Nothing listens here. Suites that send mail pass a fake mailer.
  SMTP_URL: "smtp://127.0.0.1:9",
  MAIL_FROM: "PPDB MBSS <ppdb@mbss.test>",
  NOTIFICATION_WORKER: "off",
} as const;

export function testConfig(overrides: Partial<Record<keyof typeof TEST_ENV, string>> = {}) {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
