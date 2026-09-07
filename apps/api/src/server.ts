import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";
import { ensureBootstrapAdministrator } from "./modules/staff/bootstrap.ts";

const config = loadConfig();
const app = await buildApp(config);

if (config.bootstrapAdminEmail) {
  const result = await ensureBootstrapAdministrator(app.db, config.bootstrapAdminEmail);
  app.log.info(result, "bootstrap administrator");
}

await app.listen({ port: config.port, host: "0.0.0.0" });
