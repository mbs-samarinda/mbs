import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";
import { ensureBootstrapAdministrator, requireSchools } from "./modules/staff/bootstrap.ts";

const config = loadConfig();
const app = await buildApp(config);

// Node is PID 1 in the container, where an unhandled signal is ignored and
// Docker kills the process mid-request after its grace period.
//
// A signal during startup waits for startup to finish: closing early would end
// the pool under the bootstrap queries, and Fastify still listens after close().
// once: a second identical signal falls back to Node's default and kills a
// stuck startup or shutdown.
let started = false;
let shuttingDown = false;
function shutDown() {
  app.close().catch((error: unknown) => {
    app.log.error({ err: error }, "shutdown failed");
    process.exitCode = 1;
  });
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (started && !shuttingDown) shutDown();
    shuttingDown = true;
  });
}

await requireSchools(app.db);

if (config.bootstrapAdminEmail) {
  const result = await ensureBootstrapAdministrator(app.db, config.bootstrapAdminEmail);
  app.log.info(result, "bootstrap administrator");
}

started = true;
if (shuttingDown) shutDown();
else await app.listen({ port: config.port, host: "0.0.0.0" });
