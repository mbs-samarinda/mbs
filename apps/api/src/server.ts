import { buildApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.port, host: "0.0.0.0" });
