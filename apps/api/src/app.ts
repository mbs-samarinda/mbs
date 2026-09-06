import { createDatabase, type Database } from "@mbs/db";
import { RPCHandler } from "@orpc/server/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config/env.ts";
import { router } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.isProduction ? {} : { transport: { target: "pino-pretty" } }),
    },
  });

  app.decorate("db", createDatabase(config.databaseUrl));
  await app.register(healthRoutes);

  const handler = new RPCHandler(router);
  app.all("/api/rpc/*", async (request, reply) => {
    const { matched } = await handler.handle(request, reply, {
      prefix: "/api/rpc",
      context: { db: app.db },
    });
    if (!matched) reply.status(404).send({ error: "Not found" });
  });

  return app;
}
