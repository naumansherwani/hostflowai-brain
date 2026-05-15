import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok } from "../lib/response.js";

const router: IRouter = Router();

router.get("/ping", requireAuth, (req, res) => {
  req.log.info({ user_id: req.user?.sub }, "Authenticated ping");
  res.json(
    ok(
      {
        pong: true,
        user_id: req.user?.sub,
        email: req.user?.email,
        server_time: new Date().toISOString(),
      },
      req.trace_id
    )
  );
});

export default router;
