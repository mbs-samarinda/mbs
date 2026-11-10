import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";
import { ensureBootstrapAdministrator, requireSchools } from "./modules/staff/bootstrap.ts";

const config = loadConfig();
const app = await buildApp(config);

// Fail the start, not a request months later, when the migrations never ran.
await requireSchools(app.db);

if (config.bootstrapAdminEmail) {
  const result = await ensureBootstrapAdministrator(app.db, config.bootstrapAdminEmail);
  app.log.info(result, "bootstrap administrator");
}

// Node is PID 1 in the container, where an unhandled signal is ignored and
// Docker kills the process mid-request after its grace period. Closing lets
// in-flight requests finish and ends the database pool.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: config.port, host: "0.0.0.0" });
