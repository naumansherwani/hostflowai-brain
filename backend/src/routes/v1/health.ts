import { Router, type IRouter } from "express";
import { ok } from "../../lib/response.js";

const router: IRouter = Router();

router.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=10");
  res.json(
    ok(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        brain: "HostFlow AI Backend",
        uptime_seconds: Math.floor(process.uptime()),
        region: process.env["FLY_REGION"] ?? "replit-us",
      },
      req.trace_id
    )
  );
});

export default router;
