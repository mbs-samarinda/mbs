import { z } from "zod";

// The only place this application reads process.env. Startup fails loudly here
// rather than somewhere deep in a request months later.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3000),
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
