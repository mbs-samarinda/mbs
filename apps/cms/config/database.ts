import type { Core } from "@strapi/strapi";

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_NAME",
  "DATABASE_USERNAME",
  "DATABASE_PASSWORD",
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  // The defaults below suit a fresh clone. In production a missing variable is
  // a broken deploy, and a default would aim the CMS at a database that is not
  // there, or worse, one that is. Nothing connects until a query runs, which is
  // why `strapi ts:generate-types` works with no database at all.
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !env(name));
  if (env("NODE_ENV") === "production" && missing.length > 0) {
    throw new Error(`Missing database settings: ${missing.join(", ")}.`);
  }

  return {
    connection: {
      // Postgres only: pg is the only driver installed.
      client: "postgres",
      connection: {
        // No connectionString on purpose. The API exports DATABASE_URL for the
        // core database, and knex lets a connection string override the fields
        // below — which would aim Strapi at the core database and let it run
        // its own migrations there. Strapi connects by field only.
        host: env("DATABASE_HOST", "localhost"),
        port: env.int("DATABASE_PORT", 5432),
        database: env("DATABASE_NAME", "strapi"),
        user: env("DATABASE_USERNAME", "strapi"),
        password: env("DATABASE_PASSWORD", "strapi"),
        ssl: env.bool("DATABASE_SSL", false) && {
          key: env("DATABASE_SSL_KEY", undefined),
          cert: env("DATABASE_SSL_CERT", undefined),
          ca: env("DATABASE_SSL_CA", undefined),
          capath: env("DATABASE_SSL_CAPATH", undefined),
          cipher: env("DATABASE_SSL_CIPHER", undefined),
          rejectUnauthorized: env.bool("DATABASE_SSL_REJECT_UNAUTHORIZED", true),
        },
        schema: env("DATABASE_SCHEMA", "public"),
      },
      pool: { min: env.int("DATABASE_POOL_MIN", 2), max: env.int("DATABASE_POOL_MAX", 10) },
      acquireConnectionTimeout: env.int("DATABASE_CONNECTION_TIMEOUT", 60000),
    },
  };
};

export default config;
