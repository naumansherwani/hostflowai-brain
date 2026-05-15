import { createHash } from "crypto";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { randomUUID } from "crypto";

const WATCH_URL    = "https://www.hostflowai.net";
const POLL_MS      = 5_000;
const TIMEOUT_MS   = 10_000;

interface DeployState {
  lastHash:       string | null;
  lastEtag:       string | null;
  lastCheckedAt:  string | null;
  lastDeployedAt: string | null;
  deployCount:    number;
  status:         "watching" | "error";
  lastError:      string | null;
}

const state: DeployState = {
  lastHash:       null,
  lastEtag:       null,
  lastCheckedAt:  null,
  lastDeployedAt: null,
  deployCount:    0,
  status:         "watching",
  lastError:      null,
};

async function checkForDeploy(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(WATCH_URL, {
      method:  "GET",
      signal:  controller.signal,
      headers: { "User-Agent": "HostFlow-Brain-DeployWatcher/1.0" },
    });

    clearTimeout(timeout);

    const body  = await res.text();
    const etag  = res.headers.get("etag") ?? "";
    const hash  = createHash("sha256").update(body.slice(0, 8000)).digest("hex").slice(0, 16);

    state.lastCheckedAt = new Date().toISOString();
    state.status        = "watching";
    state.lastError     = null;

    const isFirstCheck = state.lastHash === null;
    const changed      = !isFirstCheck && (hash !== state.lastHash || (etag && etag !== state.lastEtag));

    if (changed) {
      state.deployCount++;
      state.lastDeployedAt = new Date().toISOString();

      logger.info(
        { oldHash: state.lastHash, newHash: hash, deployCount: state.deployCount },
        "Lovable deploy detected — site changed"
      );

      const traceId = randomUUID();

      eventBus.broadcast("lovable_deployed", {
        source:       "deploy_watcher",
        detected_at:  state.lastDeployedAt,
        deploy_count: state.deployCount,
        hash:         hash,
        url:          WATCH_URL,
        message:      "Lovable published a new update — brain detected it automatically",
      }, traceId);

      try {
        const { db, events } = await import("@workspace/db");
        await db.insert(events).values({
          traceId:   traceId,
          eventType: "lovable.deployed",
          payload: {
            hash,
            deploy_count: state.deployCount,
            detected_at:  state.lastDeployedAt,
            url:          WATCH_URL,
          },
        });
      } catch (dbErr) {
        logger.warn({ err: dbErr }, "Deploy event DB write failed (non-fatal)");
      }
    } else if (isFirstCheck) {
      logger.info({ hash, url: WATCH_URL }, "Deploy watcher started — baseline captured");
    }

    state.lastHash = hash;
    state.lastEtag = etag;

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.status    = "error";
    state.lastError = msg;
    logger.warn({ err: msg, url: WATCH_URL }, "Deploy watcher check failed (will retry)");
  }
}

export function startDeployWatcher(): void {
  logger.info({ url: WATCH_URL, pollMs: POLL_MS }, "Deploy watcher started");
  checkForDeploy();
  setInterval(checkForDeploy, POLL_MS);
}

export function getDeployWatcherState(): DeployState {
  return { ...state };
}
