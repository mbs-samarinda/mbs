import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";

import { createDatabase, type Database } from "@mbs/db";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { Config } from "./config/env.ts";
import {
  createFamilyAuth,
  createStaffAuth,
  REQUEST_ID_HEADER,
  SIGN_IN_CODE_MINUTES,
  type Audience,
  type FamilyAuth,
  type StaffAuth,
} from "./modules/auth/auth.ts";
import { createSmtpMailer, type Mailer } from "./modules/notification/email.ts";
import {
  createNotificationWorker,
  type NotificationWorker,
} from "./modules/notification/worker.ts";
import { router } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    auth: { FAMILY: FamilyAuth; STAFF: StaffAuth };
    notifications: NotificationWorker;
  }
}

export type AppDeps = { mailer?: Mailer; logStream?: { write(line: string): void } };

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Handed to the client on every response, so it has to stay unique across
    // restarts. Fastify's default is a counter that starts again at req-1.
    genReqId: () => randomUUID(),
    frameworkErrors: (error, request, reply) => {
      const status = error.statusCode ?? 400;
      request.log.info({ statusCode: status, code: error.code }, "request refused");
      reply.hijack();
      reply.raw
        .writeHead(status, { "content-type": "application/json", "x-request-id": request.id })
        .end(JSON.stringify({ error: STATUS_CODES[status] }));
    },
    logger: {
      level: config.logLevel,
      serializers: { req: requestLogFieldsWithoutQuery },
      ...(deps.logStream
        ? { stream: deps.logStream }
        : config.isProduction
          ? {}
          : { transport: { target: "pino-pretty" } }),
    },
  });

  const db = createDatabase(config.databaseUrl);
  app.decorate("db", db);

  const notifications = createNotificationWorker({
    db,
    databaseUrl: config.databaseUrl,
    mailer:
      deps.mailer ??
      createSmtpMailer({
        url: config.mail.smtpUrl,
        from: config.mail.from,
        domain: config.mail.domain,
      }),
    log: app.log,
    codeMinutes: SIGN_IN_CODE_MINUTES,
  });
  app.decorate("notifications", notifications);
  app.addHook("onClose", async () => {
    await notifications.stop();
    await db.$client.end({ timeout: 5 });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // Better Auth catches its own errors and prints them to the console, query
  // parameters included. This routes them through the same redaction. Its
  // lines carry no request id, so a failure on /api/auth/* is found by time.
  const logger = {
    log: (level: "info" | "warn" | "error" | "debug", message: string, ...args: unknown[]) =>
      app.log[level]({ args: args.map(redactArg) }, `better-auth: ${redactMessage(message)}`),
  };
  app.decorate("auth", {
    FAMILY: createFamilyAuth(db, config, {
      logger,
      sendSignInCode: async (email, code) => {
        await notifications.sendSignInCode(email, code);
      },
    }),
    STAFF: createStaffAuth(db, config, { logger }),
  });

  const appUrls = { FAMILY: config.auth.familyAppUrl, STAFF: config.auth.adminAppUrl };
  const audiences = new Map<string, Audience>([
    [new URL(appUrls.FAMILY).host, "FAMILY"],
    [new URL(appUrls.STAFF).host, "STAFF"],
  ]);
  const audienceOf = (request: FastifyRequest) =>
    audiences.get(request.headers.host?.toLowerCase() ?? "") ?? null;

  // Fastify's default handler logs the error whole and echoes its message to
  // the client. Client errors keep that default.
  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error);
    if (status < 500) {
      reply.send(error);
      return;
    }
    request.log.error({ err: redactError(error) }, "unexpected error");
    reply.status(status).send({ error: STATUS_CODES[status] });
  });
  // Fastify's default handler logs and echoes the full URL, query string included.
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "Not found" });
  });
  await app.register(healthRoutes);

  // Better Auth speaks Fetch. Protocol callbacks stay ordinary Fastify routes
  // rather than oRPC procedures: Google redirects a browser here, and there is
  // no contract to describe.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const audience = audienceOf(request);
      if (!audience) return reply.status(404).send({ error: "Not found" });
      const auth = app.auth[audience];

      const url = new URL(request.url, appUrls[audience]);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: authHeaders(request),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });

  const handler = new RPCHandler(router, {
    interceptors: [
      // oRPC answers an unexpected error with a bare 500 and logs nothing.
      onError((error, { context }) => {
        if (error instanceof ORPCError && error.status < 500) return;
        context.log.error({ err: redactError(error) }, "unexpected error in procedure");
      }),
    ],
  });
  // These procedures authenticate by cookie, so they need CSRF protection. It
  // comes from the session cookie itself: Better Auth sets SameSite=Lax, so a
  // cross-site POST never carries it and arrives unauthenticated.
  app.all("/api/rpc/*", async (request, reply) => {
    const audience = audienceOf(request);
    const session = audience
      ? await app.auth[audience].api.getSession({ headers: authHeaders(request) })
      : null;

    const { matched } = await handler.handle(request, reply, {
      prefix: "/api/rpc",
      context: {
        db: app.db,
        session: audience && session ? { audience, user: session.user } : { audience: null },
        log: request.log,
      },
    });
    if (!matched) reply.status(404).send({ error: "Not found" });
  });

  return app;
}

function authHeaders(request: FastifyRequest) {
  const headers = fromNodeHeaders(request.headers);
  headers.set(REQUEST_ID_HEADER, request.id);
  return headers;
}

/**
 * Drizzle puts the query parameters, emails among them, in its message and on
 * the error itself. So the log keeps each error's type and code, and the
 * message and stack of the innermost one only, which comes from the driver.
 * ponytail: a Postgres data error (22xxx) quotes its input; the contract parses
 * input before any query today, so none is expected here.
 */
function redactError(error: unknown) {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error; current = current.cause) chain.push(current);
  const innermost = chain.at(-1);
  return {
    chain: chain.map((link) => ({
      type: link.constructor.name,
      code: "code" in link ? link.code : undefined,
    })),
    message: innermost?.message ?? String(error),
    stack: innermost?.stack,
  };
}

/** Reads the status the way Fastify does: `status`, then `statusCode`, else 500. */
function statusOf(error: unknown) {
  if (typeof error !== "object" || error === null) return 500;
  for (const value of [
    "status" in error ? error.status : undefined,
    "statusCode" in error ? error.statusCode : undefined,
  ]) {
    if (typeof value === "number" && value >= 400 && value < 600) return value;
  }
  return 500;
}

/** Better Auth passes an error alone or inside a plain object. */
function redactArg(arg: unknown): unknown {
  if (arg instanceof Error) return redactError(arg);
  if (arg === null || typeof arg !== "object" || Array.isArray(arg)) return arg;
  return Object.fromEntries(
    Object.entries(arg).map(([key, value]) => [
      key,
      value instanceof Error ? redactError(value) : value,
    ]),
  );
}

/**
 * Some Better Auth messages interpolate an error, and a Drizzle message ends in
 * "params: ...".
 * ponytail: matches Drizzle's message shape only; other drivers' text passes.
 */
function redactMessage(message: string) {
  return message.replace(/\nparams: [\s\S]*/, "\nparams: [redacted]");
}

function requestLogFieldsWithoutQuery(
  request: Pick<FastifyRequest, "method" | "url" | "host" | "ip" | "socket">,
) {
  const { remotePort } = request.socket;
  return {
    method: request.method,
    url: request.url.replace(/\?.*$/s, ""),
    host: request.host,
    remoteAddress: request.ip,
    ...(remotePort === undefined ? {} : { remotePort }),
  };
}
