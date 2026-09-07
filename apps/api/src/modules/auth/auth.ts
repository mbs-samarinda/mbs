import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@mbs/db";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";

import type { Config } from "../../config/env.ts";
import { isApprovedLoginEmail } from "../staff/repository.ts";

/**
 * Better Auth owns identity: the user, account, session and verification
 * tables, the Google handshake, and the session cookie. It owns no
 * authorization — who a signed-in person is allowed to be is resolved from the
 * staff tables in `../staff`.
 */
export function createAuth(db: Database, config: Config) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: config.auth.secret,
    baseURL: config.auth.baseUrl,
    // The committee app is the only origin allowed to drive these endpoints.
    trustedOrigins: [config.auth.adminAppUrl],
    socialProviders: {
      google: {
        clientId: config.auth.google.clientId,
        clientSecret: config.auth.google.clientSecret,
      },
    },
    onAPIError: {
      // A rejected sign-in has to land somewhere the committee app owns.
      // Without this it ends on Better Auth's own unstyled error page.
      errorURL: `${config.auth.adminAppUrl}/access-denied`,
    },
    advanced: {
      // Deliberately no crossSubDomainCookies. Cookies stay host-only so
      // admin.mbss.sch.id never hands a staff session to a school profile site
      // or to the parent application.
      useSecureCookies: config.isProduction,
    },
    databaseHooks: {
      user: {
        create: {
          // Without this, anyone with a Google account creates a user row and
          // is only turned away later at authorization. Staff are the only
          // audience of this instance today, so an unapproved address never
          // becomes an identity at all.
          //
          // When parent sign-in arrives this cannot stay a blanket rule.
          // Replace it with a `hooks.before` on /sign-in/social, which can read
          // ctx.body.callbackURL and tell the committee app from the parent
          // app.
          before: async (user) => {
            if (!(await isApprovedLoginEmail(db, user.email.toLowerCase()))) {
              throw new APIError("FORBIDDEN", { message: "This account has no access." });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
