import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", () => ({ status: "ok" }));

  // Readiness is separate from liveness: it proves the database answers.
  app.get("/ready", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });
}
