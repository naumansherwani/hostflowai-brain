// ─────────────────────────────────────────────────────────────────────────────
// Customer Health Score — Churn Predictor Engine
// Score 0-100: 80+ healthy | 50-79 at risk | 25-49 high risk | 0-24 critical
// Recalculated fire-and-forget after every advisor conversation.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { eq, and, gte, lt, count, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { ok, err } from "../lib/response.js";
import { logger } from "../lib/logger.js";

const router = Router();
const FOUNDER_ID = "d089432d-5d6b-416e-bd29-abe913121d99";

// ── Score calculation engine ──────────────────────────────────────────────────
export async function calculateHealthScore(userId: string, industry: string): Promise<void> {
  try {
    const {
      db, userHealthScores, customer360Profiles,
      aiUsageLog, aiResolutionIssues, subscriptions,
    } = await import("@workspace/db");

    const now     = new Date();
    const day1ago = new Date(now.getTime() - 1  * 86400_000);
    const day3ago = new Date(now.getTime() - 3  * 86400_000);
    const day7ago = new Date(now.getTime() - 7  * 86400_000);
    const day14ago= new Date(now.getTime() - 14 * 86400_000);
    const day30ago= new Date(now.getTime() - 30 * 86400_000);

    // ── 1. Engagement score (30%) — last interaction from customer_360_profiles ──
    const [profile] = await db
      .select({ lastAt: customer360Profiles.lastInteractionAt, total: customer360Profiles.totalInteractions })
      .from(customer360Profiles)
      .where(eq(customer360Profiles.userId, userId))
      .limit(1);

    let engagementScore = 50;
    const signals: Array<{ type: string; weight: number; message: string }> = [];
    if (profile?.lastAt) {
      const last = new Date(profile.lastAt);
      if (last >= day1ago)   { engagementScore = 100; }
      else if (last >= day3ago)  { engagementScore = 85; }
      else if (last >= day7ago)  { engagementScore = 65; signals.push({ type: "no_activity_7d",  weight: -15, message: "No activity in 7 days" }); }
      else if (last >= day14ago) { engagementScore = 40; signals.push({ type: "no_activity_14d", weight: -30, message: "No activity in 14 days" }); }
      else if (last >= day30ago) { engagementScore = 20; signals.push({ type: "no_activity_30d", weight: -50, message: "No activity in 30 days — churn risk" }); }
      else                       { engagementScore = 5;  signals.push({ type: "inactive",        weight: -70, message: "Inactive for 30+ days" }); }
    } else {
      engagementScore = 40;
      signals.push({ type: "never_active", weight: -30, message: "No advisor interactions recorded" });
    }

    // ── 2. Issue score (25%) — open resolution issues ─────────────────────────
    const [issueRow] = await db
      .select({ cnt: count() })
      .from(aiResolutionIssues)
      .where(
        and(
          eq(aiResolutionIssues.userId, userId),
          sql`${aiResolutionIssues.status} IN ('active','sherlock_active')`
        )
      );
    const openIssues = issueRow?.cnt ?? 0;

    let issueScore = 100;
    if (openIssues === 1)      { issueScore = 75; signals.push({ type: "open_issue_1",     weight: -15, message: "1 unresolved issue" }); }
    else if (openIssues === 2) { issueScore = 50; signals.push({ type: "open_issues_2",    weight: -30, message: "2 unresolved issues" }); }
    else if (openIssues >= 3)  { issueScore = 20; signals.push({ type: "open_issues_many", weight: -50, message: `${openIssues} unresolved issues — urgent attention needed` }); }

    // Critical open issue
    const [critRow] = await db
      .select({ cnt: count() })
      .from(aiResolutionIssues)
      .where(
        and(
          eq(aiResolutionIssues.userId, userId),
          eq(aiResolutionIssues.issueType, "critical"),
          sql`${aiResolutionIssues.status} IN ('active','sherlock_active')`
        )
      );
    if ((critRow?.cnt ?? 0) > 0) {
      issueScore = Math.max(0, issueScore - 20);
      signals.push({ type: "critical_issue_open", weight: -20, message: "Critical issue unresolved" });
    }

    // ── 3. Subscription score (20%) ───────────────────────────────────────────
    const [sub] = await db
      .select({ plan: subscriptions.plan, status: subscriptions.status, cancelAtEnd: subscriptions.cancelAtPeriodEnd, trialEndsAt: subscriptions.trialEndsAt })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1);

    let subscriptionScore = 70;
    if (sub) {
      if (sub.status === "active") {
        if (sub.plan === "premium" || sub.plan === "enterprise") subscriptionScore = 100;
        else if (sub.plan === "pro")   subscriptionScore = 90;
        else if (sub.plan === "basic") subscriptionScore = 75;
        else subscriptionScore = 60;

        if (sub.cancelAtEnd) {
          subscriptionScore = Math.max(10, subscriptionScore - 40);
          signals.push({ type: "cancel_at_period_end", weight: -40, message: "User has cancelled — subscription ending" });
        }
      } else if (sub.status === "trialing") {
        subscriptionScore = 55;
        if (sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date(now.getTime() + 3 * 86400_000)) {
          signals.push({ type: "trial_expiring_soon", weight: -15, message: "Trial expires in <3 days — not converted" });
          subscriptionScore = 35;
        }
      } else if (sub.status === "past_due") {
        subscriptionScore = 20;
        signals.push({ type: "payment_past_due", weight: -50, message: "Payment past due — high churn risk" });
      } else {
        subscriptionScore = 0;
        signals.push({ type: "no_active_subscription", weight: -60, message: "No active subscription" });
      }
    } else {
      subscriptionScore = 30;
      signals.push({ type: "no_subscription_record", weight: -40, message: "No subscription record found" });
    }

    // ── 4. Usage score (25%) — AI usage last 7d vs prior 7d ──────────────────
    const [recentUsage] = await db
      .select({ cnt: count() })
      .from(aiUsageLog)
      .where(
        and(
          eq(aiUsageLog.userId, userId as `${string}-${string}-${string}-${string}-${string}`),
          gte(aiUsageLog.createdAt, day7ago)
        )
      );
    const [priorUsage] = await db
      .select({ cnt: count() })
      .from(aiUsageLog)
      .where(
        and(
          eq(aiUsageLog.userId, userId as `${string}-${string}-${string}-${string}-${string}`),
          gte(aiUsageLog.createdAt, day14ago),
          lt(aiUsageLog.createdAt, day7ago)
        )
      );

    const recent = recentUsage?.cnt ?? 0;
    const prior  = priorUsage?.cnt  ?? 0;
    let usageScore = 70;

    if (recent === 0 && prior === 0) {
      usageScore = 30;
      signals.push({ type: "no_ai_usage", weight: -40, message: "No AI usage in 14 days" });
    } else if (recent === 0) {
      usageScore = 15;
      signals.push({ type: "usage_dropped_zero", weight: -55, message: "AI usage dropped to zero this week" });
    } else if (prior === 0) {
      usageScore = 80;
    } else {
      const ratio = recent / prior;
      if      (ratio >= 1.2) usageScore = 100;
      else if (ratio >= 0.8) usageScore = 85;
      else if (ratio >= 0.5) { usageScore = 65; signals.push({ type: "usage_declining", weight: -20, message: `AI usage down ${Math.round((1 - ratio) * 100)}% vs last week` }); }
      else                   { usageScore = 35; signals.push({ type: "usage_sharply_down", weight: -40, message: `AI usage down ${Math.round((1 - ratio) * 100)}% — investigate` }); }
    }

    // ── Master score (weighted) ───────────────────────────────────────────────
    const healthScore = Math.round(
      engagementScore  * 0.30 +
      issueScore       * 0.25 +
      subscriptionScore* 0.20 +
      usageScore       * 0.25
    );

    let churnRisk: "low" | "medium" | "high" | "critical" = "low";
    if      (healthScore >= 80) churnRisk = "low";
    else if (healthScore >= 50) churnRisk = "medium";
    else if (healthScore >= 25) churnRisk = "high";
    else                        churnRisk = "critical";

    // Revenue at risk estimate (rough — based on plan)
    const planRevMap: Record<string, number> = { premium: 150, enterprise: 500, pro: 80, basic: 30, trial: 0 };
    const monthlyRevenue = planRevMap[sub?.plan ?? "trial"] ?? 30;
    const churnMultiplier = { low: 0, medium: 0.2, high: 0.6, critical: 0.95 };
    const revenueAtRisk = (monthlyRevenue * churnMultiplier[churnRisk] * 12).toFixed(2);

    // Advisor action recommendation
    let advisorAction: string | null = null;
    if      (churnRisk === "critical") advisorAction = `URGENT: Direct outreach required — ${signals[0]?.message ?? "critical churn risk"}. Estimated annual revenue at risk: £${revenueAtRisk}.`;
    else if (churnRisk === "high")     advisorAction = `Proactive call recommended — ${signals[0]?.message ?? "high churn risk"}. Revenue at risk: £${revenueAtRisk}/yr.`;
    else if (churnRisk === "medium")   advisorAction = `Monitor closely — ${signals[0]?.message ?? "engagement declining"}. Consider a check-in message.`;

    // ── Upsert into DB ────────────────────────────────────────────────────────
    await db
      .insert(userHealthScores)
      .values({
        userId,
        industry,
        healthScore,
        churnRisk,
        engagementScore,
        issueScore,
        subscriptionScore,
        usageScore,
        revenueAtRisk,
        revenueAtRiskCurrency: "GBP",
        signals,
        advisorAction,
        calculatedAt: new Date(),
      })
      .onConflictDoNothing(); // unique index on userId — we use a separate upsert below

    // Upsert: update existing record if one exists
    await db
      .update(userHealthScores)
      .set({ healthScore, churnRisk, engagementScore, issueScore, subscriptionScore, usageScore, revenueAtRisk, revenueAtRiskCurrency: "GBP", signals, advisorAction, calculatedAt: new Date() })
      .where(eq(userHealthScores.userId, userId));

  } catch (e) {
    logger.warn({ err: e, userId }, "calculateHealthScore failed — non-fatal");
  }
}

// ── GET /api/health-scores/me — user's own score ──────────────────────────────
router.get("/me", requireAuth, requireSurface("dashboard"), async (req, res) => {
  const { db, userHealthScores } = await import("@workspace/db");
  const userId = String(req.user!.sub);

  const [row] = await db
    .select()
    .from(userHealthScores)
    .where(eq(userHealthScores.userId, userId))
    .limit(1);

  if (!row) {
    return res.json(ok({ healthScore: null, message: "Score not yet calculated — start a conversation with your advisor." }));
  }
  return res.json(ok(row));
});

// ── GET /api/health-scores/admin — all users, sorted by churn risk (founder only) ──
router.get("/admin", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, userHealthScores } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(userHealthScores)
    .orderBy(userHealthScores.healthScore); // lowest first = highest risk first

  return res.json(ok({ total: rows.length, scores: rows }));
});

// ── GET /api/health-scores/admin/critical — critical + high risk only ─────────
router.get("/admin/critical", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, userHealthScores } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(userHealthScores)
    .where(sql`${userHealthScores.churnRisk} IN ('critical','high')`)
    .orderBy(userHealthScores.healthScore);

  return res.json(ok({ total: rows.length, atRiskUsers: rows }));
});

// ── POST /api/health-scores/recalculate/:userId — force recalculate (founder only) ──
router.post("/recalculate/:userId", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const userId   = req.params["userId"] as string;
  const industry = (req.body as { industry?: string }).industry ?? "unknown";
  await calculateHealthScore(userId, industry);

  const { db, userHealthScores } = await import("@workspace/db");
  const [row] = await db.select().from(userHealthScores).where(eq(userHealthScores.userId, userId)).limit(1);
  return res.json(ok(row ?? { message: "Calculated — no prior record found." }));
});

export { router as healthScoresRouter };
