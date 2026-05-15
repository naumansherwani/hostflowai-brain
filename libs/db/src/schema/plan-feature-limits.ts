import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// -1 = unlimited  |  0 = disabled  |  N = exact cap
// Plans: trial | basic | pro | premium
// Internal AI agents: ALWAYS unlimited — these caps apply to USER-FACING endpoints only
export const planFeatureLimits = pgTable("plan_feature_limits", {
  plan:                  text("plan").primaryKey(),         // trial | basic | pro | premium
  // ── AI caps (user-facing only) ───────────────────────────────────────────
  aiDailyMessages:       integer("ai_daily_messages").notNull().default(-1),
  aiHourlyFairUse:       integer("ai_hourly_fair_use").notNull().default(200),
  aiPricingUses:         integer("ai_pricing_uses").notNull().default(-1),   // per month
  aiFollowups:           integer("ai_followups").notNull().default(-1),      // per month
  aiCalendarMonthly:     integer("ai_calendar_monthly").notNull().default(-1),
  aiVoiceMinutes:        integer("ai_voice_minutes").notNull().default(0),   // 0=disabled, N=min/mo, -1=unlimited
  aiDemandForecasting:   boolean("ai_demand_forecasting").notNull().default(false),
  aiConflictResolution:  boolean("ai_conflict_resolution").notNull().default(false),
  aiCustomTraining:      boolean("ai_custom_training").notNull().default(false),
  // ── Core caps ────────────────────────────────────────────────────────────
  crmContacts:           integer("crm_contacts").notNull().default(-1),
  bookingsMonthly:       integer("bookings_monthly").notNull().default(-1),
  industries:            integer("industries").notNull().default(1),
  dealPipeline:          boolean("deal_pipeline").notNull().default(false),
  whiteLabelMultiTeam:   boolean("white_label_multi_team").notNull().default(false),
  // ── Meta ─────────────────────────────────────────────────────────────────
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanFeatureLimitsSchema = createInsertSchema(planFeatureLimits).omit({
  updatedAt: true,
});

export type PlanFeatureLimits       = typeof planFeatureLimits.$inferSelect;
export type InsertPlanFeatureLimits = z.infer<typeof insertPlanFeatureLimitsSchema>;
