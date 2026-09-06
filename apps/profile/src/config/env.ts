import { z } from "zod";

// The only place this application reads process.env.
const EnvSchema = z.object({
  API_BASE_URL: z.url(),
  BASE_DOMAIN: z.string().min(1),
});

export type Config = {
  readonly apiBaseUrl: string;
  readonly baseDomain: string;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return { apiBaseUrl: parsed.data.API_BASE_URL, baseDomain: parsed.data.BASE_DOMAIN };
}
