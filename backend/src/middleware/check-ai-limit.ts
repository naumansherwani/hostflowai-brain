// ─────────────────────────────────────────────────────────────────────────────
// Plan Enforcement Middleware — Spec §8.2 (Zero Ambiguity)
//
// Flow per spec:
//   1. Read plan from `subscriptions`
//   2. Read limit from `plan_feature_limits`
//   3. Read usage from `ai_usage_log` (daily/hourly) or `feature_usage` (monthly)
//   4. is_unlimited (-1) → ALLOW fast-path
//   5. usage_count >= limit_value → 429 BLOCK
//   6. ALLOW + increment atomically
//
// Fail-open: DB errors NEVER block users. Logged as warnings.
// Internal AI agents (Sherlock, Owner Advisor): bypass all limits.
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
import { err } from "../lib/response.js";

// Feature key → which plan_feature_limits column to read
const DAILY_HOURLY_FEATURES = new Set(["advisor.chat", "advisor.escalate"]);

const MONTHLY_FEATURE_COLUMN: Record<string, string> = {
  "pricing.ai":   "aiPricingUses",
  "ai.followup":  "aiFollowups",
  "voice.minutes": "aiVoiceMinutes",
  "calendar.ai":  "aiCalendarMonthly",
};

// Next plan for upgrade hints in 429 responses
const NEXT_PLAN: Record<string, string> = {
  trial:    "basic",
  basic:    "pro",
  pro:      "premium",
  premium:  "premium",
};

export function checkAiLimit(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) { next(); return; }

    // 👑 OWNER BYPASS — unlimited access, no plan checks ever
    if (req.isOwner) {
      req.log?.info({ featureKey }, "👑 Owner bypass — checkAiLimit skipped");
      next();
      return;
    }

    try {
      const { db, planFeatureLimits, aiUsageLog, featureUsage, subscriptions } =
        await import("@workspace/db");
      const { eq, sql } = await import("drizzle-orm");

      const userId = user.sub;

      // ── Step 1: Get user plan ───────────────────────────────────────────────
      const [sub] = await db
        .select({ plan: subscriptions.plan, trialEndsAt: subscriptions.trialEndsAt })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId as unknown as string))
        .limit(1);

      const rawPlan   = sub?.plan ?? "trial";
      const plan      = rawPlan === "standard" ? "pro" : rawPlan; // migration guard (old 'standard' → 'pro')

      // Trial expiry check — if trial expired, treat as blocked
      if (plan === "trial" && sub?.trialEndsAt) {
        const trialExpired = new Date() > new Date(sub.trialEndsAt);
        if (trialExpired) {
          res.status(429).json({
            ok:    false,
            data:  null,
            error: {
              code:       "TRIAL_EXPIRED",
              message:    "Your 3-day trial has expired. Upgrade to Basic ($15/mo) to continue.",
              upgrade_to: "basic",
            },
            trace_id: req.trace_id,
          });
          return;
        }
      }

      // ── Step 2: Get limits ──────────────────────────────────────────────────
      const [limits] = await db
        .select()
        .from(planFeatureLimits)
        .where(eq(planFeatureLimits.plan, plan))
        .limit(1);

      if (!limits) { next(); return; } // No limits row = fail open

      // ── Step 3+4: Check by feature window type ──────────────────────────────
      if (DAILY_HOURLY_FEATURES.has(featureKey)) {
        const dailyCap  = limits.aiDailyMessages;
        const hourlyCap = limits.aiHourlyFairUse;

        // Unlimited fast-path (-1 = unlimited)
        if (dailyCap === -1 && hourlyCap === -1) {
          await insertUsageLog(db, aiUsageLog, userId, featureKey);
          next();
          return;
        }

        const now       = new Date();
        const dayStart  = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        const hourStart = new Date(now.getTime() - 60 * 60 * 1000);

        if (dailyCap !== -1) {
          const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(aiUsageLog)
            .where(sql`user_id = ${userId} AND endpoint = ${featureKey} AND created_at >= ${dayStart.toISOString()}`);
          const used = row?.count ?? 0;
          if (used >= dailyCap) {
            res.status(429).json(err(
              "AI_DAILY_LIMIT",
              `Daily AI limit reached (${used}/${dailyCap} on ${plan} plan). Resets at midnight UTC. Upgrade to ${NEXT_PLAN[plan]} for more.`,
              req.trace_id
            ));
            return;
          }
        }

        if (hourlyCap !== -1) {
          const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(aiUsageLog)
            .where(sql`user_id = ${userId} AND endpoint = ${featureKey} AND created_at >= ${hourStart.toISOString()}`);
          const used = row?.count ?? 0;
          if (used >= hourlyCap) {
            res.status(429).json(err(
              "AI_HOURLY_LIMIT",
              `Hourly fair-use limit reached (${used}/${hourlyCap} on ${plan} plan). Try again in a few minutes.`,
              req.trace_id
            ));
            return;
          }
        }

        await insertUsageLog(db, aiUsageLog, userId, featureKey);
        next();
        return;
      }

      // Monthly feature check (pricing.ai, ai.followup, voice.minutes)
      const limitColumn = MONTHLY_FEATURE_COLUMN[featureKey];
      if (limitColumn) {
        const monthlyCap = ((limits as unknown) as Record<string, number>)[limitColumn] ?? 0;

        if (monthlyCap === 0) {
          res.status(403).json(err(
            "FEATURE_NOT_ON_PLAN",
            `${featureKey} is not available on the ${plan} plan. Upgrade to ${NEXT_PLAN[plan]} to unlock.`,
            req.trace_id
          ));
          return;
        }

        if (monthlyCap !== -1) {
          const now        = new Date();
          const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

          const [usageRow] = await db
            .select({ usageCount: featureUsage.usageCount })
            .from(featureUsage)
            .where(sql`user_id = ${userId} AND feature_key = ${featureKey} AND period_start = ${periodStart.toISOString()}`)
            .limit(1);

          const used = usageRow?.usageCount ?? 0;

          if (used >= monthlyCap) {
            res.status(429).json({
              ok:    false,
              data:  null,
              error: {
                code:       "AI_MONTHLY_LIMIT",
                message:    `Monthly limit reached (${used}/${monthlyCap} on ${plan} plan). Resets 1st UTC. Upgrade to ${NEXT_PLAN[plan]} for more.`,
                upgrade_to: NEXT_PLAN[plan],
              },
              trace_id: req.trace_id,
            });
            return;
          }

          // Atomic upsert — increment
          await db.execute(sql`
            INSERT INTO feature_usage (user_id, feature_key, usage_count, period_start, last_used_at, created_at)
            VALUES (${userId}::uuid, ${featureKey}, 1, ${periodStart.toISOString()}, NOW(), NOW())
            ON CONFLICT (user_id, feature_key, period_start)
            DO UPDATE SET usage_count = feature_usage.usage_count + 1, last_used_at = NOW()
          `);
        }

        next();
        return;
      }

      // Unknown feature key → allow (fail open, log for review)
      req.log?.warn({ featureKey }, "Unknown feature key in checkAiLimit — allowing");
      next();

    } catch (e) {
      req.log?.warn({ err: e, featureKey }, "AI limit check failed — failing open");
      next();
    }
  };
}

async function insertUsageLog(
  db:       unknown,
  table:    unknown,
  userId:   string,
  endpoint: string
): Promise<void> {
  try {
    await (db as { insert: Function }).insert(table).values({ userId, endpoint });
  } catch { /* non-fatal */ }
}
