import type { Core } from "@strapi/strapi";

const REQUIRED = ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USERNAME", "DATABASE_PASSWORD"];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  // pg is the only driver installed. An old .env naming sqlite or mysql would
  // otherwise land on Postgres without a word.
  const client = env("DATABASE_CLIENT");
  if (client && client !== "postgres") {
    throw new Error(`DATABASE_CLIENT is "${client}", but the CMS only runs on postgres.`);
  }

  // The defaults below suit a fresh clone, and only there. Anywhere else a
  // missing variable is a broken deploy, and a default would aim the CMS at a
  // database that is not there, or worse, one that is. Strapi sets an unset
  // NODE_ENV to "development" before config loads. Nothing connects until a
  // query runs, which is why `strapi ts:generate-types` works with no database.
  const mode = env("NODE_ENV");
  const missing = REQUIRED.filter((name) => !env(name));
  if (mode !== "development" && mode !== "test" && missing.length > 0) {
    throw new Error(`Missing database settings: ${missing.join(", ")}.`);
  }

  return {
    connection: {
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
