import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { rateLimit } from "express-rate-limit";
import { ok, err } from "../../lib/response.js";
import { eventBus } from "../../lib/event-bus.js";

// ─── /v1/push strict limiter — 20 broadcasts/min max per IP ──────────────────
const pushRateLimit = rateLimit({
  windowMs:       60 * 1000,
  max:            20,
  standardHeaders: true,
  legacyHeaders:  false,
  validate:       false,
  keyGenerator:   (req) => req.ip ?? req.socket.remoteAddress ?? "unknown",
  handler:        (_req, res) => {
    res.status(429).json(err("PUSH_RATE_LIMITED", "Push broadcast limit reached (20/min). Slow down."));
  },
});

// ─── /v1/stream strict limiter — 5 SSE connections/min per IP ────────────────
const streamRateLimit = rateLimit({
  windowMs:       60 * 1000,
  max:            5,
  standardHeaders: true,
  legacyHeaders:  false,
  validate:       false,
  keyGenerator:   (req) => req.ip ?? req.socket.remoteAddress ?? "unknown",
  handler:        (_req, res) => {
    res.status(429).json(err("STREAM_RATE_LIMITED", "Too many SSE connection attempts (5/min max)."));
  },
});

const router: IRouter = Router();

// ─── SSE stream — Lovable connects here, stays open forever ──────────────────
router.get("/stream", streamRateLimit, (req, res) => {
  const clientId = (req.query["client_id"] as string) ?? randomUUID();
  const origin   = req.headers["origin"] ?? "*";

  res.setHeader("Content-Type",                "text/event-stream");
  res.setHeader("Cache-Control",               "no-cache, no-transform");
  res.setHeader("Connection",                  "keep-alive");
  res.setHeader("X-Accel-Buffering",           "no");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.flushHeaders();

  // Initial handshake — Lovable knows connection is live
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    client_id:        clientId,
    brain_status:     "live",
    connected_at:     new Date().toISOString(),
    server_version:   "1.0.0",
    message:          "HostFlow AI Brain is live. All updates will be pushed instantly.",
  })}\n\n`);

  req.log.info({ clientId, connectedClients: eventBus.connectedCount + 1 }, "SSE stream opened");

  eventBus.register(clientId, res);

  req.on("close", () => {
    eventBus.unregister(clientId);
    req.log.info({ clientId }, "SSE stream closed");
  });
});

// ─── Push endpoint — Lovable or internal code can trigger a broadcast ─────────
router.post("/push", pushRateLimit, (req, res) => {
  const { event, data, source } = req.body as {
    event?: string;
    data?:  Record<string, unknown>;
    source?: string;
  };

  if (!event || typeof event !== "string") {
    res.status(400).json(err("VALIDATION_ERROR", "event name is required", req.trace_id));
    return;
  }

  const safeData = (data && typeof data === "object" && !Array.isArray(data))
    ? data
    : {};

  eventBus.broadcast(event, { ...safeData, source: source ?? "lovable" }, req.trace_id);

  req.log.info({ event, source, clients: eventBus.connectedCount }, "Manual push broadcast");

  res.json(
    ok(
      {
        broadcast:       true,
        event,
        clients_reached: eventBus.connectedCount,
        timestamp:       new Date().toISOString(),
      },
      req.trace_id
    )
  );
});

// ─── Status — connected clients + recent events + deploy watcher ─────────────
router.get("/stream/status", async (_req, res) => {
  const { getDeployWatcherState } = await import("../../lib/deploy-watcher.js");
  const deploy = getDeployWatcherState();

  res.json(
    ok(
      {
        connected_clients:  eventBus.connectedCount,
        recent_events:      eventBus.recentEvents.slice(0, 10),
        deploy_watcher: {
          status:           deploy.status,
          last_checked_at:  deploy.lastCheckedAt,
          last_deployed_at: deploy.lastDeployedAt,
          deploy_count:     deploy.deployCount,
          last_error:       deploy.lastError,
        },
        server_time:        new Date().toISOString(),
      },
      _req.trace_id
    )
  );
});

export default router;
