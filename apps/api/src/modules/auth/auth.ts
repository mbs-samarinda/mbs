import { hkdfSync } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema, type Database } from "@mbs/db";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getIP, isAPIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";

import type { Config } from "../../config/env.ts";
import { appendAuditLog } from "../audit.ts";
import { isApprovedLoginEmail } from "../staff/repository.ts";

export type Audience = "FAMILY" | "STAFF";

export const SIGN_IN_CODE_MINUTES = 5;

type AuthDeps = {
  logger?: BetterAuthOptions["logger"];
  sendSignInCode: (email: string, code: string) => Promise<void>;
};

export function createFamilyAuth(db: Database, config: Config, deps: AuthDeps) {
  const base = baseOptions(db, config, "FAMILY", config.auth.familyAppUrl, deps);
  return betterAuth({
    ...base,
    plugins: [
      emailOTP({
        expiresIn: SIGN_IN_CODE_MINUTES * 60,
        storeOTP: "hashed",
        // The plugin's own limit of 3 wrong tries per code stays. Its per-IP
        // limit of 3 requests a minute does not: families on mobile data share
        // carrier IPs, so 3 would turn away parents nobody is attacking.
        rateLimit: { window: 60, max: 10 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") throw signInOnly();
          await deps.sendSignInCode(email, otp);
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email-otp") return;
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type === "sign-in") return;
        if (ctx.path?.startsWith("/email-otp/") || ctx.path?.startsWith("/forget-password/")) {
          throw signInOnly();
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email-otp") return;
        const returned: unknown = ctx.context.returned;
        if (!isAPIError(returned)) return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
        const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
        await auditSignIn(db, "FAMILY", ctx, {
          action: "auth.sign_in_failed",
          userId: found?.user.id ?? null,
          metadata: { method: "EMAIL_CODE", reason: errorCode(returned) },
        });
      }),
    },
  });
}

export function createStaffAuth(
  db: Database,
  config: Config,
  deps: Omit<AuthDeps, "sendSignInCode">,
) {
  const base = baseOptions(db, config, "STAFF", config.auth.adminAppUrl, deps);

  // Better Auth redirects to errorURL only when the error carries a code.
  const refuseUnapproved = async (email: string) => {
    if (!(await isApprovedLoginEmail(db, email.toLowerCase()))) {
      throw new APIError("FORBIDDEN", {
        code: "account_not_approved",
        message: "This account has no access.",
      });
    }
  };

  return betterAuth({
    ...base,
    databaseHooks: {
      ...base.databaseHooks,
      user: {
        create: {
          before: async (user) => refuseUnapproved(user.email),
        },
      },
      session: {
        ...base.databaseHooks.session,
        create: {
          ...base.databaseHooks.session.create,
          before: async (session) => {
            const [row] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            await refuseUnapproved(row?.email ?? "");
          },
        },
      },
    },
  });
}

function signInOnly() {
  return new APIError("BAD_REQUEST", {
    code: "SIGN_IN_ONLY",
    message: "Codes are for signing in only.",
  });
}

export type FamilyAuth = ReturnType<typeof createFamilyAuth>;
export type StaffAuth = ReturnType<typeof createStaffAuth>;

export async function sessionCookie(auth: FamilyAuth | StaffAuth, userId: string) {
  const context = await auth.$context;
  const { token } = await context.internalAdapter.createSession(userId);
  const signed = `${token}.${await makeSignature(token, context.secret)}`;
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
}

function baseOptions(
  db: Database,
  config: Config,
  audience: Audience,
  appUrl: string,
  deps: Pick<AuthDeps, "logger">,
) {
  return {
    logger: deps.logger,
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: instanceSecret(config.auth.secret, audience),
    baseURL: appUrl,
    trustedOrigins: [appUrl],
    socialProviders: {
      google: {
        clientId: config.auth.google.clientId,
        clientSecret: config.auth.google.clientSecret,
      },
    },
    onAPIError: {
      // A rejected sign-in has to land somewhere the app owns. Without this it
      // ends on Better Auth's own unstyled error page. Better Auth appends
      // `?error=<code>`, which is the flag the app can read.
      errorURL: `${appUrl}/`,
    },
    // On in every environment, so tests run the limit production runs.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      // Browsers share cookies across ports, and in development both apps are localhost.
      cookiePrefix: audience === "FAMILY" ? "mbs_family" : "mbs_staff",
      // Deliberately no crossSubDomainCookies. Cookies stay host-only so
      // admin.mbss.sch.id never hands a staff session to a school profile site
      // or to the parent application.
      useSecureCookies: config.isProduction,
    },
    // Better Auth deletes expired sessions, so these rows are the only lasting
    // record of who signed in. They run after Better Auth's own write, outside
    // any transaction of ours: an audit row can be missing if the API dies
    // between the two, never the other way round.
    databaseHooks: {
      session: {
        create: {
          after: async (session, ctx) => {
            await auditSignIn(db, audience, ctx, {
              action: "auth.sign_in",
              userId: session.userId,
              metadata: { method: methodOf(ctx?.path), sessionId: session.id },
            });
          },
        },
        delete: {
          after: async (session, ctx) => {
            if (ctx?.path !== "/sign-out") return;
            await auditSignIn(db, audience, ctx, {
              action: "auth.sign_out",
              userId: session.userId,
              metadata: { sessionId: session.id },
            });
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

function instanceSecret(secret: string, audience: Audience) {
  return Buffer.from(hkdfSync("sha256", secret, "", `mbs-auth:${audience}`, 32)).toString("hex");
}

type SessionCreateHooks = NonNullable<
  NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]
>;
type EndpointContext = Parameters<NonNullable<SessionCreateHooks["after"]>>[1];

async function auditSignIn(
  db: Database,
  audience: Audience,
  ctx: EndpointContext,
  entry: { action: string; userId: string | null; metadata: Record<string, unknown> },
) {
  const headers = ctx?.request?.headers ?? ctx?.headers;
  await appendAuditLog(db, {
    actorType: audience,
    actorId: entry.userId,
    action: entry.action,
    entityType: "user",
    entityId: entry.userId ?? "unknown",
    metadata: entry.metadata,
    ipAddress: headers && ctx ? getIP(headers, ctx.context.options) : null,
    requestId: headers?.get(REQUEST_ID_HEADER) ?? null,
    userAgent: headers?.get("user-agent") ?? null,
  });
}

export const REQUEST_ID_HEADER = "x-request-id";

function methodOf(path: string | undefined) {
  if (path === "/sign-in/email-otp") return "EMAIL_CODE";
  if (path?.startsWith("/callback/")) return "GOOGLE";
  return path ?? "INTERNAL";
}

function errorCode(error: APIError) {
  const code: unknown = error.body?.code;
  return typeof code === "string" ? code : error.status;
}
