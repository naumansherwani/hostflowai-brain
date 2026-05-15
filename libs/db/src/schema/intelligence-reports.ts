import { pgTable, bigserial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Reports — HostFlow AI Revenue Intelligence Engine
// Auto-generated monthly ROI + performance reports for the Founder
// Data source: internal DB (ai_usage_log, subscriptions, conversations, memory)
// Delivery: stored in DB + emailed FROM revenuereport@hostflowai.net TO Nauman
//
// 10-section structure per Nauman's specification
// ─────────────────────────────────────────────────────────────────────────────

export const intelligenceReports = pgTable(
  "intelligence_reports",
  {
    id:            bigserial("id", { mode: "number" }).primaryKey(),

    // Period
    periodLabel:   text("period_label").notNull(),   // "April 2026"
    periodType:    text("period_type").notNull(),     // monthly | quarterly | yearly
    periodStart:   timestamp("period_start", { withTimezone: true }),
    periodEnd:     timestamp("period_end",   { withTimezone: true }),

    // ── 10 Report Sections ───────────────────────────────────────────────────

    // 1. Executive Summary — 3-4 sentence narrative verdict
    s1ExecutiveSummary: text("s1_executive_summary"),

    // 2. Revenue Impact — tracked revenue growth from AI activity
    s2RevenueImpact: jsonb("s2_revenue_impact").$type<{
      revenueGrowthEstimate:   string | null;  // "PKR 4.2M estimated via AI-assisted bookings"
      conversionImprovements:  string | null;
      bookingIncreases:        string | null;
      occupancyImprovements:   string | null;
      repeatCustomerGrowth:    string | null;
      aiAssistedUpsells:       string | null;
      abandonedRecoveries:     string | null;
      totalRevenueImpact:      string | null;  // final number or range
      confidenceNote:          string | null;  // data quality note
    }>(),

    // 3. Cost Savings — vs traditional tools/staffing
    s3CostSavings: jsonb("s3_cost_savings").$type<{
      vsMarketplaceFees:       string | null;  // "Saved ~$2,400 vs OTA commission"
      vsManualSupport:         string | null;  // "Equivalent to 3 FTE support agents"
      vsExternalAICRM:         string | null;  // "vs Salesforce AI + Zendesk ~$X/mo"
      operationalEfficiency:   string | null;
      automationImpact:        string | null;
      totalSavingsEstimate:    string | null;
      savingsConfidence:       number | null;  // 0-100
    }>(),

    // 4. AI Resolution Metrics — platform performance data
    s4AiResolutionMetrics: jsonb("s4_ai_resolution_metrics").$type<{
      totalAiCallsThisPeriod:  number | null;
      avgResolutionTime:       string | null;  // "< 3 seconds"
      aiFirstResolutionRate:   string | null;  // "94%"
      sherlockEscalationRate:  string | null;  // "6%"
      automationPercentage:    string | null;  // "89%"
      engagementTrend:         string | null;  // "up 12% MoM"
      topEndpoints:            Array<{ endpoint: string; count: number }> | null;
      channelBreakdown:        { chat: number; email: number; whatsapp: number } | null;
      advisorEffectiveness:    Array<{ advisor: string; interactions: number; industry: string }> | null;
    }>(),

    // 5. Recovery Engine — retention + recovery metrics
    s5RecoveryEngine: jsonb("s5_recovery_engine").$type<{
      paymentRecoveries:       string | null;
      abandonedWorkflows:      string | null;
      customerRetentionSaves:  string | null;
      aiInterventionCount:     number | null;
      recoveredRevenueEstimate: string | null;
      preventedChurnValue:     string | null;
      operationalContinuity:   string | null;
    }>(),

    // 6. Industry Advisor Insights — per-industry breakdown
    s6IndustryAdvisorInsights: jsonb("s6_industry_advisor_insights").$type<Array<{
      industry:          string;
      advisor:           string;
      interactions:      number;
      memoriesExtracted: number;
      topInsight:        string;
      performanceNote:   string;
    }>>(),

    // 7. Sherlock Strategic Notes — owner-level analysis
    s7SherlockStrategicNotes: text("s7_sherlock_strategic_notes"),

    // 8. Growth Recommendations — exactly 4 intelligence outputs
    s8GrowthRecommendations: jsonb("s8_growth_recommendations").$type<{
      strategicGrowthRec:    { title: string; detail: string; estimatedImpact: string } | null;
      operationalWarning:    { title: string; detail: string; urgency: string } | null;
      missedOpportunity:     { title: string; detail: string; potentialValue: string } | null;
      revenueOptimization:   { title: string; prediction: string; triggerCondition: string } | null;
    }>(),

    // 9. Forecast Next Month
    s9ForecastNextMonth: jsonb("s9_forecast_next_month").$type<{
      expectedGrowthRange:   string | null;  // "8–14%"
      keyDrivers:            string[] | null;
      watchItems:            string[] | null;
      recommendedActions:    string[] | null;
      confidenceLevel:       number | null;  // 0-100
    }>(),

    // 10. Net Business Impact — final ROI verdict
    s10NetBusinessImpact: jsonb("s10_net_business_impact").$type<{
      totalRevenueImpact:    string | null;
      totalCostSavings:      string | null;
      totalROIEstimate:      string | null;   // "~8.4x ROI this period"
      hostflowValueScore:    number | null;   // 0-100 proprietary HostFlow value score
      verdictOneLiner:       string | null;   // "HostFlow AI delivered X this month"
      keyWin:                string | null;   // single biggest win
    }>(),

    // ── Platform Data Snapshot used to generate report ───────────────────────
    dataSnapshot: jsonb("data_snapshot").$type<{
      totalSubscriptions:    number;
      activeUsers:           number;
      trialUsers:            number;
      totalAiCalls:          number;
      totalConversations:    number;
      totalMemories:         number;
      totalCustomer360:      number;
      totalKnowledgeNodes:   number;
      externalReportsCount:  number;
      periodStart:           string;
      periodEnd:             string;
    }>(),

    // ── Quality ──────────────────────────────────────────────────────────────
    confidenceScore:    integer("confidence_score"),   // 0-100
    dataQualityNote:    text("data_quality_note"),     // e.g. "Low volume — early stage"

    // ── Processing ───────────────────────────────────────────────────────────
    status:             text("status").notNull().default("generating"),
    processingError:    text("processing_error"),
    generatedBy:        text("generated_by").notNull().default("manual"),

    // ── Email Delivery ────────────────────────────────────────────────────────
    emailedTo:          text("emailed_to"),
    emailedAt:          timestamp("emailed_at", { withTimezone: true }),

    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ir_status_created_idx").on(t.status, t.createdAt),
    index("ir_period_type_idx").on(t.periodType, t.periodStart),
  ]
);

export const insertIntelligenceReportSchema = createInsertSchema(intelligenceReports).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type IntelligenceReport       = typeof intelligenceReports.$inferSelect;
export type InsertIntelligenceReport = z.infer<typeof insertIntelligenceReportSchema>;
