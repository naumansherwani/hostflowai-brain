import { pgTable, bigserial, uuid, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-user feature usage counter — used for plan enforcement (Nauman spec §2)
// Each row = one user + one feature_key combination
// Reset logic: monthly features reset at start of month, daily features reset at midnight UTC
export const featureUsage = pgTable(
  "feature_usage",
  {
    id:           bigserial("id", { mode: "number" }).primaryKey(),
    userId:       uuid("user_id").notNull(),
    featureKey:   text("feature_key").notNull(),       // e.g. "advisor.chat", "pricing.ai", "voice.minutes"
    usageCount:   integer("usage_count").notNull().default(0),
    periodStart:  timestamp("period_start", { withTimezone: true }).notNull(), // start of current billing period
    lastUsedAt:   timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("fu_user_feature_period_uniq").on(t.userId, t.featureKey, t.periodStart),
    index("fu_user_feature_idx").on(t.userId, t.featureKey),
  ]
);

export const insertFeatureUsageSchema = createInsertSchema(featureUsage).omit({
  id: true,
  createdAt: true,
});

export type FeatureUsage       = typeof featureUsage.$inferSelect;
export type InsertFeatureUsage = z.infer<typeof insertFeatureUsageSchema>;
