import { pgTable, bigserial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Customer 360 Profile — AI CRM per user
// Continuously enriched by all advisor interactions.
// Revenue predictions gain accuracy from accumulated history (target: 25k msgs).
// user_id is text to support UUID + phone
// ─────────────────────────────────────────────────────────────────────────────
export const customer360Profiles = pgTable(
  "customer_360_profiles",
  {
    id:                  bigserial("id", { mode: "number" }).primaryKey(),
    userId:              text("user_id").notNull(),
    industry:            text("industry").notNull().default("unknown"),
    advisor:             text("advisor").notNull().default("unknown"),
    businessName:        text("business_name"),
    preferences:         jsonb("preferences").notNull().default({}),
    businessGoals:       jsonb("business_goals").notNull().default([]),
    painPoints:          jsonb("pain_points").notNull().default([]),
    revenueTrends:       jsonb("revenue_trends").notNull().default({}),
    integrations:        jsonb("integrations").notNull().default([]),
    preferredLanguage:   text("preferred_language").notNull().default("en"),
    totalInteractions:   integer("total_interactions").notNull().default(0),
    lastInteractionAt:   timestamp("last_interaction_at", { withTimezone: true }),
    sherlockVerdicts:    jsonb("sherlock_verdicts").notNull().default([]),
    revenuePrediction:   jsonb("revenue_prediction").notNull().default({}),
    profileCompleteness: integer("profile_completeness").notNull().default(0),
    createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("c360_user_idx").on(t.userId),
  ]
);

export const insertCustomer360ProfileSchema = createInsertSchema(customer360Profiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Customer360Profile       = typeof customer360Profiles.$inferSelect;
export type InsertCustomer360Profile = z.infer<typeof insertCustomer360ProfileSchema>;
