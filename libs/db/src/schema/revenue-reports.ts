import { pgTable, bigserial, text, integer, numeric, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Reports — structured financial data per business per period
// Sources: inbound email (revenuereport@hostflowai.net) OR manual dashboard entry
// Sherlock AI auto-analyzes each report and stores verdict + insights
// ─────────────────────────────────────────────────────────────────────────────

export const revenueReports = pgTable(
  "revenue_reports",
  {
    id:             bigserial("id", { mode: "number" }).primaryKey(),

    // Who submitted this report
    submittedBy:    text("submitted_by").notNull(),     // email or user_id
    submitterName:  text("submitter_name"),             // display name
    businessName:   text("business_name"),              // parsed from content

    // Period info
    periodLabel:    text("period_label").notNull(),     // e.g. "April 2026", "Q1 2026"
    periodType:     text("period_type").notNull(),      // monthly | quarterly | yearly | custom
    periodStart:    timestamp("period_start", { withTimezone: true }),
    periodEnd:      timestamp("period_end",   { withTimezone: true }),
    industry:       text("industry").notNull(),         // one of 8 industries or "unknown"

    // Source
    source:         text("source").notNull().default("email"),  // email | manual | api
    emailMessageId: text("email_message_id"),                   // for dedup

    // Raw content (what was submitted)
    rawContent:     text("raw_content").notNull(),

    // Parsed metrics (AI-extracted structured data)
    parsedMetrics:  jsonb("parsed_metrics").$type<{
      totalRevenue?:        number;
      previousRevenue?:     number;
      growthRate?:          number;   // percentage
      occupancyRate?:       number;   // for hospitality
      avgDailyRate?:        number;   // for hospitality / car rental
      totalBookings?:       number;
      cancellations?:       number;
      topRevenueStream?:    string;
      costOfGoods?:         number;
      grossProfit?:         number;
      currency?:            string;
      additionalMetrics?:   Record<string, number | string>;
    }>(),

    // Financial summary
    totalRevenue:   numeric("total_revenue", { precision: 18, scale: 2 }),
    previousRevenue: numeric("previous_revenue", { precision: 18, scale: 2 }),
    growthRate:     numeric("growth_rate", { precision: 7, scale: 2 }),  // %
    currency:       text("currency").notNull().default("USD"),

    // Sherlock AI Analysis
    aiSummary:      text("ai_summary"),                 // executive summary
    aiInsights:     jsonb("ai_insights").$type<Array<{
      type:     "opportunity" | "risk" | "trend" | "action";
      priority: "critical" | "high" | "medium" | "low";
      title:    string;
      detail:   string;
      impact?:  string;            // estimated revenue impact
    }>>(),
    aiConfidence:   integer("ai_confidence"),           // 0-100 how confident Sherlock is

    // Processing status
    status:         text("status").notNull().default("pending"),  // pending | processed | error
    processingError: text("processing_error"),
    processedAt:    timestamp("processed_at", { withTimezone: true }),

    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rr_submitted_by_idx").on(t.submittedBy),
    index("rr_industry_period_idx").on(t.industry, t.periodStart),
    index("rr_status_created_idx").on(t.status, t.createdAt),
    uniqueIndex("rr_email_message_id_idx").on(t.emailMessageId).where(sql`${t.emailMessageId} is not null`),
  ]
);

export const insertRevenueReportSchema = createInsertSchema(revenueReports).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const selectRevenueReportSchema = createSelectSchema(revenueReports);

export type RevenueReport       = typeof revenueReports.$inferSelect;
export type InsertRevenueReport = z.infer<typeof insertRevenueReportSchema>;
