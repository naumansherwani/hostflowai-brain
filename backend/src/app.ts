import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "crypto";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { err } from "./lib/response.js";

const ALLOWED_ORIGINS = [
  // Primary domain
  "https://www.hostflowai.net",
  "https://hostflowai.net",
  // Replit production (both URLs — data-migration-master is the live deployment)
  "https://data-migration-master.replit.app",
  "https://hostflowai-brain--naumansherwani.replit.app",
  // Lovable preview URLs
  "https://id-preview--0ac55503-220d-4481-83fe-d4e85a8e516e.lovable.app",
  "https://smart-stay-automaton.lovable.app",
  "https://0ac55503-220d-4481-83fe-d4e85a8e516e.lovableproject.com",
  // Local dev
  "http://localhost",
  "http://localhost:80",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:25257",
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/id-preview-[a-z0-9]+-{2}0ac55503-220d-4481-83fe-d4e85a8e516e\.lovable\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/,
  /^https:\/\/[a-z0-9-]+--naumansherwani\.replit\.app$/,
  /^https:\/\/[a-z0-9-]+\.replit\.dev$/,
  /^https:\/\/[a-z0-9-]+-\d{2}-[a-z0-9]+\.riker\.replit\.dev$/,
];

const app: Express = express();

app.use(compression({
  level: 6,
  threshold: 512,
  // Never compress SSE streams — compression middleware buffers chunks and breaks streaming
  filter: (req, res) => {
    if (req.path.includes("/advisor") || req.path.includes("/stream")) return false;
    return compression.filter(req, res);
  },
}));

app.use(
  pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as Express.Request & { trace_id: string }).trace_id =
    (req.headers["x-trace-id"] as string) ?? randomUUID();
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) { callback(null, false); return; }
      if (origin === "null") { callback(new Error("CORS blocked: null origin")); return; }
      if (ALLOWED_ORIGINS.includes(origin)) { callback(null, true); return; }
      if (ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin))) { callback(null, true); return; }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Trace-Id", "X-HostFlow-Surface"],
    exposedHeaders: ["X-Server-Time", "X-Trace-Id", "Retry-After"],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

app.use(express.json({
  limit: "256kb",
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Server-Time", new Date().toISOString());
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=60, max=1000");
  next();
});

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    skip: (req) => {
      // 👑 Owner bypass — unlimited requests, no rate limiting
      return (req as Express.Request & { isOwner?: boolean }).isOwner === true;
    },
    keyGenerator: (req) => {
      const user = (req as Express.Request & { user?: { sub: string } }).user;
      if (user?.sub) return user.sub;
      return req.ip ?? req.socket.remoteAddress ?? "unknown";
    },
    handler: (req, res) => {
      res.status(429).json(
        err("RATE_LIMITED", "Too many requests. Please slow down.",
          (req as Express.Request & { trace_id: string }).trace_id)
      );
    },
  }),
);

app.use("/api", router);

app.use((_req: Request, res: Response) => {
  res.status(404).json(err("NOT_FOUND", "Endpoint not found"));
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: error }, "Unhandled error");
  res.status(500).json(err("INTERNAL_ERROR", "An unexpected error occurred"));
});

export default app;
