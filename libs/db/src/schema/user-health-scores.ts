import { pgTable, bigserial, text, integer, numeric, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// User Health Scores — Customer Churn Predictor
// Recalculated automatically after every advisor conversation.
// Score 0-100: 80+ = healthy, 50-79 = at risk, 0-49 = critical churn risk.
// ─────────────────────────────────────────────────────────────────────────────
export const userHealthScores = pgTable(
  "user_health_scores",
  {
    id:               bigserial("id", { mode: "number" }).primaryKey(),
    userId:           text("user_id").notNull(),
    industry:         text("industry").notNull(),

    // Master score 0–100
    healthScore:      integer("health_score").notNull().default(100),
    churnRisk:        text("churn_risk").notNull().default("low"),
    // churn_risk: low | medium | high | critical

    // Component scores (each 0–100)
    engagementScore:  integer("engagement_score").notNull().default(100),
    // based on: last_interaction_at, total_interactions
    issueScore:       integer("issue_score").notNull().default(100),
    // based on: open ai_resolution_issues count + severity
    subscriptionScore: integer("subscription_score").notNull().default(100),
    // based on: plan status, trial expiry, cancel_at_period_end
    usageScore:       integer("usage_score").notNull().default(100),
    // based on: ai_usage_log last 7 days vs prior 7 days

    // Revenue at risk from churn (estimated)
    revenueAtRisk:    numeric("revenue_at_risk", { precision: 12, scale: 2 }),
    revenueAtRiskCurrency: text("revenue_at_risk_currency").notNull().default("GBP"),

    // Signals that contributed to this score
    signals:          jsonb("signals").notNull().default([]),
    // [{ type: "no_login_7d", weight: -20, message: "No login in 7 days" }, ...]

    // Advisor recommendation for this user
    advisorAction:    text("advisor_action"),
    // e.g. "Proactive call recommended — last login 8 days ago"

    calculatedAt:     timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("uhs_user_idx").on(t.userId),
    index("uhs_industry_churn_idx").on(t.industry, t.churnRisk),
    index("uhs_score_idx").on(t.healthScore),
  ]
);

export const insertUserHealthScoreSchema = createInsertSchema(userHealthScores).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserHealthScore       = typeof userHealthScores.$inferSelect;
export type InsertUserHealthScore = z.infer<typeof insertUserHealthScoreSchema>;
