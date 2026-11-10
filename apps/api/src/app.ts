import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";

import { createDatabase, type Database } from "@mbs/db";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config/env.ts";
import { createAuth, type Auth } from "./modules/auth/auth.ts";
import { router } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    auth: Auth;
  }
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    // Handed to the client on every response, so it has to stay unique across
    // restarts. Fastify's default is a counter that starts again at req-1.
    genReqId: () => randomUUID(),
    logger: {
      level: config.logLevel,
      ...(config.isProduction ? {} : { transport: { target: "pino-pretty" } }),
    },
  });

  const db = createDatabase(config.databaseUrl);
  app.decorate("db", db);
  app.addHook("onClose", () => db.$client.end({ timeout: 5 }));
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  // Better Auth catches its own errors and prints them to the console, query
  // parameters included. This routes them through the same redaction. Its
  // lines carry no request id, so a failure on /api/auth/* is found by time.
  app.decorate(
    "auth",
    createAuth(db, config, {
      log: (level, message, ...args) =>
        app.log[level]({ args: args.map(redactArg) }, `better-auth: ${redactMessage(message)}`),
    }),
  );
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
  await app.register(healthRoutes);

  // Better Auth speaks Fetch. Protocol callbacks stay ordinary Fastify routes
  // rather than oRPC procedures: Google redirects a browser here, and there is
  // no contract to describe.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, config.auth.baseUrl);
      const response = await app.auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
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
    // Resolved once per request, so every procedure sees the same session and
    // no handler reaches for headers itself.
    const session = await app.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    const { matched } = await handler.handle(request, reply, {
      prefix: "/api/rpc",
      context: { db: app.db, sessionUser: session?.user ?? null, log: request.log },
    });
    if (!matched) reply.status(404).send({ error: "Not found" });
  });

  return app;
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
