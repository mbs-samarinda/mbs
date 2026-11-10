import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";
import { ensureBootstrapAdministrator, requireSchools } from "./modules/staff/bootstrap.ts";

const config = loadConfig();
const app = await buildApp(config);

// Node is PID 1 in the container, where an unhandled signal is ignored and
// Docker kills the process mid-request after its grace period.
// Fastify still listens after close(), so a signal during startup must also
// stop the listen below.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.close().catch((error: unknown) => {
      app.log.error({ err: error }, "shutdown failed");
      process.exitCode = 1;
    });
  });
}

await requireSchools(app.db);

if (config.bootstrapAdminEmail) {
  const result = await ensureBootstrapAdministrator(app.db, config.bootstrapAdminEmail);
  app.log.info(result, "bootstrap administrator");
}

if (!shuttingDown) await app.listen({ port: config.port, host: "0.0.0.0" });
