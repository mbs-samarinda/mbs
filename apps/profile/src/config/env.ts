import { z } from "zod";

// The only place this application reads process.env for a service address.
// Startup fails here with the list of what is missing, rather than as a fetch
// to `undefined/api/...` somewhere in a page render.
//
// `PROFILE_APEX` is deliberately not here: it is read at module scope in
// `owners.ts`, once per process, and it has a working default.
// An unset variable and one set to "" mean the same thing: take the default.
// Without this a blank line copied from `.env.example` fails validation, and
// this module throws at import — which kills every render, not just the feature
// the variable belongs to. `apps/api/src/config/env.ts` carries the same helper.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  // Strapi. Public content, read-only, no token: the Public role carries
  // find/findOne, granted by the CMS on boot.
  CMS_URL: optional(z.url().default("http://localhost:1337")),
  // Fastify. The one source of admission facts.
  API_BASE_URL: optional(z.url().default("http://localhost:3001")),
  // Shared with the CMS, which sends it when content is published. Optional on
  // purpose: a deployment without it still serves pages, it just waits out the
  // cache window instead of being told. The route refuses every request while
  // it is unset rather than accepting unauthenticated ones.
  REVALIDATE_SECRET: optional(z.string().min(16).optional()),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const config = {
  cmsUrl: parsed.data.CMS_URL.replace(/\/$/, ""),
  apiBaseUrl: parsed.data.API_BASE_URL.replace(/\/$/, ""),
  revalidateSecret: parsed.data.REVALIDATE_SECRET,
} as const;
