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

  BETTER_AUTH_SECRET: z.string().min(32),
  // Where Google sends the browser back. Must be the API's own origin, since
  // the auth routes live at /api/auth/* on this server.
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // The committee app's origin: both the post-sign-in redirect target and the
  // one origin Better Auth trusts for cookie-authenticated requests.
  ADMIN_APP_URL: z.url(),

  // Optional. When set, that address is ensured as an active administrator with
  // access to every school on each boot. Nothing can grant staff access before
  // one administrator exists.
  BOOTSTRAP_ADMIN_EMAIL: optional(z.email().optional()),
});

// Named for what the application means, not what the variable is called, so
// nothing downstream has to know an environment variable exists.
export type Config = {
  readonly env: "development" | "test" | "production";
  readonly logLevel: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly isProduction: boolean;
  readonly auth: {
    readonly secret: string;
    readonly baseUrl: string;
    readonly adminAppUrl: string;
    readonly google: { readonly clientId: string; readonly clientSecret: string };
  };
  readonly bootstrapAdminEmail: string | undefined;
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
    auth: {
      secret: parsed.data.BETTER_AUTH_SECRET,
      baseUrl: parsed.data.BETTER_AUTH_URL,
      adminAppUrl: parsed.data.ADMIN_APP_URL,
      google: {
        clientId: parsed.data.GOOGLE_CLIENT_ID,
        clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
      },
    },
    bootstrapAdminEmail: parsed.data.BOOTSTRAP_ADMIN_EMAIL,
  };
}
