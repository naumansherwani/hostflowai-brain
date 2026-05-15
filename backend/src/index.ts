import app from "./app";
import { logger } from "./lib/logger";
import { startKeepAlive } from "./lib/keepalive.js";
import { startDeployWatcher } from "./lib/deploy-watcher.js";
import { seedPlanLimits } from "./lib/seed-plans.js";
import { startSherlockMonitor } from "./lib/sherlock-monitor.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startKeepAlive();
  startDeployWatcher();
  startSherlockMonitor();

  // Seed plan feature limits on every startup (upsert — safe to repeat)
  seedPlanLimits().then(() => {
    logger.info("Plan feature limits seeded");
  }).catch(e => {
    logger.warn({ err: e }, "Plan seed failed — non-fatal");
  });
});
