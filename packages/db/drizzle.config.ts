import { defineConfig } from "drizzle-kit";

// `generate` works offline; `migrate` and `studio` connect and will report a
// missing or wrong URL themselves.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
