import { z } from "zod";

// The only place this application reads process.env. Startup fails loudly here
// rather than somewhere deep in a request months later.
// An unset variable and one set to "" mean the same thing here: fall back to
// the default. Without this, a blank line copied from .env.example fails
// validation instead of taking the default.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  NODE_ENV: optional(z.enum(["development", "test", "production"]).default("development")),
  LOG_LEVEL: optional(z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")),
  // Matches the port both front-end dev proxies target.
  PORT: optional(z.coerce.number().int().positive().default(3001)),
  DATABASE_URL: z.url(),
});

export type Env = z.infer<typeof EnvSchema>;

export type Config = {
  readonly env: Env["NODE_ENV"];
  readonly logLevel: Env["LOG_LEVEL"];
  readonly port: number;
  readonly databaseUrl: string;
  readonly isProduction: boolean;
  readonly secureCookies: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = z.prettifyError(parsed.error);
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    isProduction,
    secureCookies: isProduction,
  };
}
