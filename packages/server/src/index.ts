import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { configFromEnv } from "./config.js";

export { buildApp } from "./app.js";
export * from "./config.js";

/**
 * True only when THIS file is the process entrypoint. Compare resolved paths,
 * not basenames: the CLI package also ships an `index.js`, and a basename check
 * boots an HTTP server every time the CLI imports this module.
 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const cfg = configFromEnv();
  const app = buildApp(cfg);
  app.listen({ port: cfg.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
