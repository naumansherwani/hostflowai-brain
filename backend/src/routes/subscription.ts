import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

router.get("/subscription/me", requireAuth, async (req, res) => {
  const userId = req.user!.sub;

  try {
    const { db, subscriptions } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    const sub = rows[0];

    if (!sub) {
      res.json(
        ok(
          {
            plan: "none",
            status: "none",
            trial_ends_at: null,
            current_period_end: null,
            cancel_at_period_end: false,
          },
          req.trace_id
        )
      );
      return;
    }

    res.json(
      ok(
        {
          plan: sub.plan,
          status: sub.status,
          trial_ends_at: sub.trialEndsAt?.toISOString() ?? null,
          current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
          cancel_at_period_end: sub.cancelAtPeriodEnd,
        },
        req.trace_id
      )
    );
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch subscription");
    res.status(500).json(err("DB_ERROR", "Failed to fetch subscription data", req.trace_id));
  }
});

export default router;
