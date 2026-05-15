import { Router, type IRouter } from "express";
import { ok } from "../lib/response.js";

const router: IRouter = Router();

router.get("/test", (req, res) => {
  req.log.info("Health test endpoint called");
  res.json(
    ok(
      {
        system: "HostFlow AI Backend",
        version: "1.0.0",
        role: "Backend Brain — Logic + AI + Data",
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
      },
      req.trace_id
    )
  );
});

export default router;
