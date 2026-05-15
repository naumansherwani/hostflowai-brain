import { logger } from "./logger.js";

const PING_INTERVAL_MS = 25_000;

export function startKeepAlive(): void {
  const selfUrl = `http://localhost:${process.env["PORT"] ?? 8080}/api/health`;

  setInterval(async () => {
    try {
      const res = await fetch(selfUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        logger.warn({ status: res.status }, "Keep-alive ping failed");
      }
    } catch {
      // silent — container is just busy
    }
  }, PING_INTERVAL_MS);

  logger.info({ interval_ms: PING_INTERVAL_MS }, "Keep-alive started");
}
