import type { Core } from "@strapi/strapi";

type Env = Core.Config.Shared.ConfigParams["env"];

const MARKET = "https://market-assets.strapi.io";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  "strapi::logger",
  "strapi::errors",
  // Expanded from the string form only to widen the image CSP. Strapi's default
  // allows images from 'self' and its own host, so with media on S3 every
  // thumbnail in the media library and every preview in the editor is blocked —
  // the files upload fine and the admin shows broken images, which reads as a
  // failed upload.
  //
  // With no AWS_ENDPOINT this contributes nothing and the default stays as
  // tight as it was. Note .env.example ships the endpoint pre-filled while
  // leaving AWS_BUCKET empty, so a developer on the filesystem provider does
  // get the bucket host in this list — harmless, and cheaper than two
  // variables that have to agree.
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https:"],
          // market-assets.strapi.io is in Strapi's own default and carries the
          // marketplace thumbnails in the admin; dropping it while widening
          // this list would be a quiet regression.
          "img-src": ["'self'", "data:", "blob:", MARKET, ...mediaHosts(env)],
          "media-src": ["'self'", "data:", "blob:", ...mediaHosts(env)],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  "strapi::cors",
  "strapi::poweredBy",
  "strapi::query",
  "strapi::body",
  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];

/**
 * The hosts media may be served from. `AWS_BASE_URL` is here as well as the
 * endpoint because a CDN in front of the bucket would be a different host, and
 * a CSP that only names the origin would block it.
 */
function mediaHosts(env: Env): string[] {
  const hosts = [env("AWS_ENDPOINT"), env("AWS_BASE_URL")]
    .filter((value): value is string => Boolean(value))
    // `new URL` throws on a value with no scheme, and this runs while Strapi is
    // loading config — so `AWS_ENDPOINT=nos.jkt-1.neo.id`, an easy thing to
    // write, would stop the CMS booting with nothing pointing at the cause.
    // Skipped instead: a missing CSP host shows broken thumbnails in the admin,
    // which is visible and recoverable.
    .flatMap((value) => {
      try {
        return [new URL(value).host];
      } catch {
        return [];
      }
    });
  // Usually the same host twice, since the base URL is the endpoint plus the
  // bucket path. They differ only when a CDN fronts the bucket.
  return [...new Set(hosts)];
}

export default config;
