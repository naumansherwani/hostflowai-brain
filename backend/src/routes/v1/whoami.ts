// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/whoami — Owner Protocol test endpoint
// Returns auth status + owner flag for any valid JWT
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { optionalAuth } from "../../middleware/jwt.js";
import { ok } from "../../lib/response.js";

const router = Router();

router.get("/whoami", optionalAuth, (req, res) => {
  res.json(ok({
    authenticated: !!req.user,
    email:         req.user?.email ?? null,
    user_id:       req.user?.sub ?? null,
    isOwner:       req.isOwner,
    greeting:      req.isOwner ? req.greeting : null,
    bypassLimits:  req.bypassLimits,
  }, req.trace_id));
});

export default router;
