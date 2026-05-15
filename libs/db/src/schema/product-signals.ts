import { pgTable, bigserial, text, integer, numeric, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Product Signals — Cross-Industry Pattern Intelligence (Sherlock-level)
// Auto-detected from advisor conversations weekly.
// Sherlock alerts Nauman bhai: "5 airlines clients asked about crew scheduling."
// These signals directly drive product roadmap decisions.
// ─────────────────────────────────────────────────────────────────────────────
export const productSignals = pgTable(
  "product_signals",
  {
    id:              bigserial("id", { mode: "number" }).primaryKey(),

    // Signal scope
    industry:        text("industry"),
    // null = cross-industry signal
    signalType:      text("signal_type").notNull(),
    // feature_request | pain_point | bug_pattern | drop_off | usage_spike | churn_risk_cluster

    // The actual signal
    topic:           text("topic").notNull(),
    // e.g. "crew_scheduling", "double_booking", "payment_failure"
    description:     text("description").notNull(),
    // Human-readable: "5 airlines clients asked about crew scheduling this week"

    // Weight/urgency
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    affectedUsers:   integer("affected_users").notNull().default(1),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 2 }).notNull().default("0.5"),
    priority:        text("priority").notNull().default("medium"),
    // low | medium | high | p0

    // Revenue impact
    revenueImpact:   numeric("revenue_impact", { precision: 12, scale: 2 }),
    // estimated ARR impact if this signal is acted upon

    // Sherlock's recommendation
    sherlockInsight: text("sherlock_insight"),
    // "Consider a dedicated crew scheduling module — 5 requests in 7 days = product-market signal."

    // Linked data
    sampleUserIds:   jsonb("sample_user_ids").notNull().default([]),
    // anonymized sample of affected users (max 5)
    relatedTopics:   jsonb("related_topics").notNull().default([]),

    // Lifecycle
    period:          text("period").notNull(),
    // "2025-W20"
    isActedUpon:     boolean("is_acted_upon").notNull().default(false),
    actedUponNote:   text("acted_upon_note"),
    // Founder notes when marking as acted upon

    detectedAt:      timestamp("detected_at",  { withTimezone: true }).notNull().defaultNow(),
    createdAt:       timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ps_industry_period_idx").on(t.industry, t.period),
    index("ps_priority_idx").on(t.priority, t.detectedAt),
    index("ps_type_idx").on(t.signalType),
  ]
);

export const insertProductSignalSchema = createInsertSchema(productSignals).omit({
  id: true,
  createdAt: true,
});

export type ProductSignal       = typeof productSignals.$inferSelect;
export type InsertProductSignal = z.infer<typeof insertProductSignalSchema>;
