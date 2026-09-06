import { createDatabase, type Database } from "@mbs/db";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config/env.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export const databasePlugin = fp(async (app: FastifyInstance, opts: { config: Config }) => {
  app.decorate("db", createDatabase(opts.config.databaseUrl));
});
