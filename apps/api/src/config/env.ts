import { z } from "zod";

// The only place this application reads process.env. Startup fails loudly here
// rather than somewhere deep in a request months later.

// An unset variable and one set to "" mean the same thing: take the default.
// Without this a blank line copied from .env.example fails validation.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  NODE_ENV: optional(z.enum(["development", "test", "production"]).default("development")),
  LOG_LEVEL: optional(z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")),
  // Matches the port both front-end dev proxies target.
  PORT: optional(z.coerce.number().int().positive().default(3001)),
  DATABASE_URL: z.url(),
});

// Named for what the application means, not what the variable is called, so
// nothing downstream has to know an environment variable exists.
export type Config = {
  readonly env: "development" | "test" | "production";
  readonly logLevel: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly isProduction: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = z.prettifyError(parsed.error);
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  const { NODE_ENV, LOG_LEVEL, PORT, DATABASE_URL } = parsed.data;

  return {
    env: NODE_ENV,
    logLevel: LOG_LEVEL,
    port: PORT,
    databaseUrl: DATABASE_URL,
    isProduction: NODE_ENV === "production",
  };
}
