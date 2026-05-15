import { pgTable, bigserial, text, integer, numeric, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Industry Benchmarks — Anonymized aggregate stats per industry
// Recalculated nightly or on-demand by founder.
// Used by advisors to tell users "Your X is Y% below industry avg."
// ─────────────────────────────────────────────────────────────────────────────
export const industryBenchmarks = pgTable(
  "industry_benchmarks",
  {
    id:              bigserial("id", { mode: "number" }).primaryKey(),
    industry:        text("industry").notNull(),
    period:          text("period").notNull(),
    // period: "2025-W20" (ISO week) or "2025-05" (month)

    // How many users contributed to this benchmark (min 3 for privacy)
    sampleSize:      integer("sample_size").notNull().default(0),

    // Core metrics — stored as jsonb for flexibility per industry
    // Each entry: { metric: "occupancy_pct", avg: 74.2, p25: 68.1, p75: 81.3, unit: "%" }
    metrics:         jsonb("metrics").notNull().default([]),

    // Advisor usage stats
    avgDailyMessages:   numeric("avg_daily_messages", { precision: 8, scale: 2 }),
    avgHealthScore:     numeric("avg_health_score",   { precision: 5, scale: 2 }),
    avgResolutionTimeMs: numeric("avg_resolution_time_ms", { precision: 12, scale: 2 }),

    // Top issues/topics this period
    topIssues:       jsonb("top_issues").notNull().default([]),
    // [{ topic: "crew_scheduling", count: 47, pct: 23.5 }, ...]

    calculatedAt:    timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:       timestamp("created_at",    { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ib_industry_period_idx").on(t.industry, t.period),
  ]
);

export const insertIndustryBenchmarkSchema = createInsertSchema(industryBenchmarks).omit({
  id: true,
  createdAt: true,
});

export type IndustryBenchmark       = typeof industryBenchmarks.$inferSelect;
export type InsertIndustryBenchmark = z.infer<typeof insertIndustryBenchmarkSchema>;
