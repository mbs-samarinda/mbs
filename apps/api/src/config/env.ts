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
    FAMILY_APP_URL: z.url(),
    ADMIN_APP_URL: z.url(),

    // The bucket that holds receipts and documents. Bytes go browser to bucket;
    // the API only signs the URLs.
    S3_ENDPOINT: z.url(),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_REGION: optional(z.string().min(1).default("us-east-1")),

    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z
      .string()
      .trim()
      .refine((value) => z.email().safeParse(addressOf(value)).success, "Not an email address."),
    NOTIFICATION_WORKER: optional(z.enum(["on", "off"]).default("on")),

    // Optional. Seeds the first administrator on boot. What it does to an
    // existing profile is in ensureBootstrapAdministrator.
    BOOTSTRAP_ADMIN_EMAIL: optional(z.string().trim().toLowerCase().pipe(z.email()).optional()),
  })
  .refine((env) => new URL(env.FAMILY_APP_URL).host !== new URL(env.ADMIN_APP_URL).host, {
    message: "Must be on a different host from ADMIN_APP_URL.",
    path: ["FAMILY_APP_URL"],
  });

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
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly uploadUrlSeconds: number;
    readonly downloadUrlSeconds: number;
  };
  readonly mail: {
    readonly smtpUrl: string;
    readonly from: string;
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
    storage: {
      endpoint: parsed.data.S3_ENDPOINT,
      region: parsed.data.S3_REGION,
      bucket: parsed.data.S3_BUCKET,
      accessKey: parsed.data.S3_ACCESS_KEY,
      secretKey: parsed.data.S3_SECRET_KEY,
      // Long enough for a slow phone upload, short enough that a copied URL in
      // a chat message is dead by the time anyone else opens it.
      uploadUrlSeconds: 15 * 60,
      // One staff member looking at one receipt.
      downloadUrlSeconds: 5 * 60,
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
