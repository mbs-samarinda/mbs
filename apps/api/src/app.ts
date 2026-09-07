import { createDatabase, type Database } from "@mbs/db";
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
    logger: {
      level: config.logLevel,
      ...(config.isProduction ? {} : { transport: { target: "pino-pretty" } }),
    },
  });

  const db = createDatabase(config.databaseUrl);
  app.decorate("db", db);
  app.decorate("auth", createAuth(db, config));
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

  const handler = new RPCHandler(router);
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
      context: { db: app.db, sessionUser: session?.user ?? null },
    });
    if (!matched) reply.status(404).send({ error: "Not found" });
  });

  return app;
}
