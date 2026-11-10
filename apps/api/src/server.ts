import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";
import { ensureBootstrapAdministrator, requireSchools } from "./modules/staff/bootstrap.ts";

const config = loadConfig();
const app = await buildApp(config);

// Node is PID 1 in the container, where an unhandled signal is ignored and
// Docker kills the process mid-request after its grace period.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
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

await app.listen({ port: config.port, host: "0.0.0.0" });
