import { z } from "zod";

// The only place this application reads process.env. Startup fails loudly here
// rather than somewhere deep in a request months later.

// An unset variable and one set to "" mean the same thing: take the default.
// Without this a blank line copied from .env.example fails validation.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z
  .object({
    NODE_ENV: optional(z.enum(["development", "test", "production"]).default("development")),
    LOG_LEVEL: optional(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    ),
    // Matches the port both front-end dev proxies target.
    PORT: optional(z.coerce.number().int().positive().default(3001)),
    DATABASE_URL: z.url(),

    BETTER_AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    // Each app's own origin. Each app reaches the API through its own host's
    // /api proxy, so each origin is also the base URL of that app's auth
    // instance: where its Google callback and its cookie land, and the one
    // origin it trusts. A request is served by the instance whose host it came to.
    FAMILY_APP_URL: z.url(),
    ADMIN_APP_URL: z.url(),

    // smtp://user:pass@host:port, or smtps:// for TLS from the first byte.
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    // A bare address or "PPDB MBSS <ppdb@mbss.sch.id>".
    MAIL_FROM: z
      .string()
      .trim()
      .refine((value) => z.email().safeParse(addressOf(value)).success, "Not an email address."),
    // Sends queued email from inside this process. Tests and the simulator turn
    // it off and drive sending themselves.
    NOTIFICATION_WORKER: optional(z.enum(["on", "off"]).default("on")),

    // Optional. Seeds the first administrator on boot. What it does to an
    // existing profile is in ensureBootstrapAdministrator.
    BOOTSTRAP_ADMIN_EMAIL: optional(z.string().trim().toLowerCase().pipe(z.email()).optional()),
  })
  .refine(
    // The API tells the two apps apart by host alone.
    (env) => new URL(env.FAMILY_APP_URL).host !== new URL(env.ADMIN_APP_URL).host,
    { message: "Must be on a different host from ADMIN_APP_URL.", path: ["FAMILY_APP_URL"] },
  );

/** The address inside "Name <address>", or the value itself. */
function addressOf(from: string) {
  return /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
}

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
    readonly familyAppUrl: string;
    readonly adminAppUrl: string;
    readonly google: { readonly clientId: string; readonly clientSecret: string };
  };
  readonly mail: {
    readonly smtpUrl: string;
    readonly from: string;
    /** The domain of the from address, which every Message-ID ends in. */
    readonly domain: string;
    readonly workerEnabled: boolean;
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
      familyAppUrl: parsed.data.FAMILY_APP_URL,
      adminAppUrl: parsed.data.ADMIN_APP_URL,
      google: {
        clientId: parsed.data.GOOGLE_CLIENT_ID,
        clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
      },
    },
    mail: {
      smtpUrl: parsed.data.SMTP_URL,
      from: parsed.data.MAIL_FROM,
      domain: addressOf(parsed.data.MAIL_FROM).split("@")[1]!,
      workerEnabled: parsed.data.NOTIFICATION_WORKER === "on",
    },
    bootstrapAdminEmail: parsed.data.BOOTSTRAP_ADMIN_EMAIL,
  };
}
