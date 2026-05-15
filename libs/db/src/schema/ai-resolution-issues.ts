import {
  pgTable, bigserial, text, boolean, integer,
  numeric, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// AI Resolution Issues — tracks every issue through the AI Resolution Hub
// issue_type:       normal (2min SLA) | critical (4min SLA)
// status:           active | monitoring | sherlock_active | resolved | failed
// revenue_risk_level: low | medium | high | critical
// stages:           jsonb array — { stage, timestamp, message }
// ─────────────────────────────────────────────────────────────────────────────
export const aiResolutionIssues = pgTable(
  "ai_resolution_issues",
  {
    id:                  bigserial("id", { mode: "number" }).primaryKey(),
    userId:              text("user_id").notNull(),
    userEmail:           text("user_email"),
    industry:            text("industry").notNull(),
    advisorName:         text("advisor_name").notNull(),
    sessionId:           text("session_id"),

    issueSummary:        text("issue_summary").notNull(),
    issueType:           text("issue_type").notNull().default("normal"),
    status:              text("status").notNull().default("active"),
    revenueRiskLevel:    text("revenue_risk_level").notNull().default("low"),

    stages:              jsonb("stages").$type<ResolutionStage[]>().notNull().default([]),

    slaMsTarget:         integer("sla_ms_target").notNull(),
    elapsedMs:           integer("elapsed_ms"),

    escalatedToSherlock: boolean("escalated_to_sherlock").notNull().default(false),
    sherlockReviewAt:    timestamp("sherlock_review_at", { withTimezone: true }),

    revenueAtRiskAmount: numeric("revenue_at_risk_amount", { precision: 12, scale: 2 }),
    revenueAtRiskCurrency: text("revenue_at_risk_currency").default("GBP"),
    revenueProtected:    numeric("revenue_protected", { precision: 12, scale: 2 }),
    resolvedEmailSent:   boolean("resolved_email_sent").notNull().default(false),
    traceId:             text("trace_id"),

    createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt:          timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("ari_user_status_idx").on(t.userId, t.status),
    index("ari_user_created_idx").on(t.userId, t.createdAt),
    index("ari_status_idx").on(t.status),
    index("ari_industry_idx").on(t.industry),
  ]
);

export interface ResolutionStage {
  stage:     string;
  timestamp: string;
  message:   string;
}

export const insertAiResolutionIssueSchema = createInsertSchema(aiResolutionIssues).omit({
  id:        true,
  createdAt: true,
  updatedAt: true,
});

export type AiResolutionIssue       = typeof aiResolutionIssues.$inferSelect;
export type InsertAiResolutionIssue = z.infer<typeof insertAiResolutionIssueSchema>;
