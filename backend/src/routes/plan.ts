// ─────────────────────────────────────────────────────────────────────────────
// GET /api/plan/limits  — All plan caps (public — Lovable reads this on load)
// GET /api/plan/me      — Current user's plan + limits (JWT required)
// Plans: trial | basic | pro | premium | enterprise
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

function formatRow(r: {
  aiDailyMessages: number; aiHourlyFairUse: number; aiPricingUses: number;
  aiFollowups: number; aiCalendarMonthly: number; aiVoiceMinutes: number;
  aiDemandForecasting: boolean; aiConflictResolution: boolean; aiCustomTraining: boolean;
  crmContacts: number; bookingsMonthly: number; industries: number;
  dealPipeline: boolean; whiteLabelMultiTeam: boolean;
}) {
  const c = (n: number, unit = "") => n === -1 ? "unlimited" : n === 0 ? "disabled" : `${n}${unit}`;
  return {
    ai: {
      daily_messages:       c(r.aiDailyMessages, "/day"),
      hourly_fair_use:      c(r.aiHourlyFairUse, "/hr"),
      pricing_uses:         c(r.aiPricingUses, "/mo"),
      followups:            c(r.aiFollowups, "/mo"),
      calendar_monthly:     c(r.aiCalendarMonthly, "/mo"),
      voice_minutes_monthly: c(r.aiVoiceMinutes, " min/mo"),
      demand_forecasting:   r.aiDemandForecasting,
      conflict_resolution:  r.aiConflictResolution,
      custom_training:      r.aiCustomTraining,
    },
    core: {
      crm_contacts:         c(r.crmContacts),
      bookings_monthly:     c(r.bookingsMonthly, "/mo"),
      industries:           r.industries === 8 ? "all 8" : r.industries,
      deal_pipeline:        r.dealPipeline,
      white_label_multi_team: r.whiteLabelMultiTeam,
    },
  };
}

// ─── GET /api/plan/limits ─────────────────────────────────────────────────────
router.get("/plan/limits", async (req, res) => {
  try {
    const { db, planFeatureLimits } = await import("@workspace/db");
    const rows = await db.select().from(planFeatureLimits);

    const asMap = Object.fromEntries(rows.map(r => [r.plan, formatRow(r)]));

    res.json(ok({
      plans:           asMap,
      plan_order:      ["trial", "basic", "pro", "premium", "enterprise"],
      internal_agents: "unlimited — no caps, no throttle",
      note:            "All numeric caps: -1=unlimited, 0=disabled, N=exact limit",
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "plan/limits failed");
    res.status(500).json(err("DB_ERROR", "Could not fetch plan limits", req.trace_id));
  }
});

// ─── GET /api/plan/me ─────────────────────────────────────────────────────────
router.get("/plan/me", requireAuth, async (req, res) => {
  const userId = req.user!.sub;

  try {
    const { db, subscriptions, planFeatureLimits } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId as unknown as string))
      .limit(1);

    const plan = sub?.plan ?? "trial";

    const [limits] = await db
      .select()
      .from(planFeatureLimits)
      .where(eq(planFeatureLimits.plan, plan))
      .limit(1);

    res.json(ok({
      plan,
      status:             sub?.status ?? "none",
      trial_ends_at:      sub?.trialEndsAt?.toISOString()        ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString()   ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd               ?? false,
      limits:             limits ? formatRow(limits) : null,
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "plan/me failed");
    res.status(500).json(err("DB_ERROR", "Could not fetch plan data", req.trace_id));
  }
});

export default router;
