// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Report Generator — Sherlock writes the 10-section report
// Pulls real platform data → feeds to Sherlock → stores full report in DB
// Emails final report FROM revenuereport@hostflowai.net TO Nauman
//
// FOUNDER TRUST RULE: Never fabricate. Every insight must be traceable.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlatformDataSnapshot } from "./intelligence-data-collector.js";

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
const FOUNDER_EMAIL = "naumansherwani@hostflowai.net";

export interface GenerateReportOptions {
  periodLabel:  string;
  periodType:   "monthly" | "quarterly" | "yearly";
  periodStart:  Date;
  periodEnd:    Date;
  generatedBy:  "manual" | "scheduled";
  sendEmail:    boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build Sherlock's data brief (injected into prompt)
// ─────────────────────────────────────────────────────────────────────────────
function buildDataBrief(d: PlatformDataSnapshot): string {
  const adv = d.conversations.byAdvisor.map(a => `${a.advisor}(${a.industry}):${a.count}`).join(" | ");
  const eps = d.aiUsage.byEndpoint.slice(0, 6).map(e => `${e.endpoint}:${e.count}`).join(" | ");
  const memTypes = d.memory.byType.map(m => `${m.type}:${m.count}(imp:${m.avgImportance},rev:${m.avgRevenue})`).join(" | ");
  const topMems = d.memory.topRevenueMemories.slice(0, 3).map(m => `  • [${m.advisor}|rev:${m.revenueScore}] ${m.summary.slice(0, 120)}`).join("\n");
  const extRep = d.externalReports.count > 0
    ? `${d.externalReports.count} reports | total revenue: ${d.externalReports.totalRevenue} | avg growth: ${d.externalReports.avgGrowthRate ?? "N/A"}% | top industry: ${d.externalReports.topIndustry ?? "N/A"}`
    : "No external revenue reports submitted this period";

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOSTFLOW AI PLATFORM DATA — ${d.period.label.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUBSCRIPTIONS
  Total: ${d.subscriptions.total} | Active: ${d.subscriptions.active} | Trial: ${d.subscriptions.trial}
  Basic: ${d.subscriptions.basic} | Pro: ${d.subscriptions.pro} | Premium: ${d.subscriptions.premium} | Enterprise: ${d.subscriptions.enterprise}
  New this period: ${d.subscriptions.newThisPeriod}

AI USAGE
  Total calls (all-time): ${d.aiUsage.totalCalls}
  Calls this period: ${d.aiUsage.callsThisPeriod} | Daily avg: ${d.aiUsage.dailyAvg}
  By endpoint: ${eps || "no data"}
  By industry: ${d.aiUsage.byIndustry.map(i => `${i.industry}:${i.count}`).join(" | ") || "no data"}

CONVERSATIONS
  Total stored: ${d.conversations.totalStored}
  New this period: ${d.conversations.newThisPeriod}
  By source — Chat: ${d.conversations.bySource.chat} | Email: ${d.conversations.bySource.email} | WhatsApp: ${d.conversations.bySource.whatsapp}
  By advisor: ${adv || "none"}

MEMORY ENGINE
  Total memories: ${d.memory.totalMemories} | New this period: ${d.memory.newThisPeriod}
  By type: ${memTypes || "none"}
  Customer 360 profiles: ${d.memory.customer360Count} | Avg completeness: ${d.memory.avgProfileCompleteness}%
  Top revenue-flagged memories:
${topMems || "  (none yet)"}

KNOWLEDGE GRAPH
  Nodes: ${d.knowledgeGraph.totalNodes} | Edges: ${d.knowledgeGraph.totalEdges}
  By type: ${d.knowledgeGraph.nodesByType.map(n => `${n.type}:${n.count}`).join(" | ") || "none"}

WHATSAPP
  Total users: ${d.whatsapp.totalUsers} | New this period: ${d.whatsapp.newThisPeriod}

EXTERNAL REVENUE REPORTS
  ${extRep}

DATA QUALITY: ${d.dataQuality.score}/100 — ${d.dataQuality.note}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask Sherlock to generate all 10 sections as structured JSON
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithSherlock(data: PlatformDataSnapshot): Promise<Record<string, unknown>> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL!, apiKey: AI_API_KEY! });

  const dataBrief = buildDataBrief(data);

  const systemPrompt = `You are Sherlock, HostFlow AI's owner-level intelligence advisor.
You are generating the monthly Revenue Intelligence Report for Muhammad Nauman Sherwani (Founder & Chairman).

${dataBrief}

FOUNDER TRUST RULE — ABSOLUTE:
- Never fabricate numbers. If data is insufficient, say so explicitly.
- All monetary estimates must be labeled as "estimated" with a confidence range.
- Never exaggerate AI impact. Be honest about early-stage platform limitations.
- Every insight must be traceable to the data above.
- Tone: executive-level, data-driven, calm, financially strategic. No hype.

Generate the 10-section Revenue Intelligence Report. Return ONLY valid JSON — no markdown, no preamble.

JSON structure:
{
  "s1_executive_summary": "3-4 sentence narrative. Performance verdict + key driver + one strategic priority. Reference specific numbers from data.",

  "s2_revenue_impact": {
    "revenueGrowthEstimate": "string or null — e.g. 'Estimated PKR X–Y based on N bookings tracked in memory vault'",
    "conversionImprovements": "string or null",
    "bookingIncreases": "string or null — use conversation volume as proxy if direct booking data unavailable",
    "occupancyImprovements": "string or null",
    "repeatCustomerGrowth": "string or null — use customer_360 repeat interaction data",
    "aiAssistedUpsells": "string or null — from memory vault recommendation memories",
    "abandonedRecoveries": "string or null",
    "totalRevenueImpact": "string — be honest if estimated or insufficient data",
    "confidenceNote": "data quality note — be explicit about what's measured vs estimated"
  },

  "s3_cost_savings": {
    "vsMarketplaceFees": "string — OTA/marketplace commission equivalent saved by using AI direct",
    "vsManualSupport": "string — FTE equivalent at market rate (use AI call volume as proxy)",
    "vsExternalAICRM": "string — vs Salesforce + Zendesk at their pricing",
    "operationalEfficiency": "string — automation rate estimate",
    "automationImpact": "string — hours saved estimate",
    "totalSavingsEstimate": "string — honest range",
    "savingsConfidence": 0-100
  },

  "s4_ai_resolution_metrics": {
    "totalAiCallsThisPeriod": number,
    "avgResolutionTime": "string — e.g. '< 3 seconds (AI processing)' — honest technical estimate",
    "aiFirstResolutionRate": "string — % of queries resolved without escalation to Sherlock",
    "sherlockEscalationRate": "string — % escalated (if escalation data unavailable, estimate from endpoint data)",
    "automationPercentage": "string",
    "engagementTrend": "string — compare to previous period if estimable, else describe trajectory",
    "topEndpoints": [{"endpoint": "string", "count": number}],
    "channelBreakdown": {"chat": number, "email": number, "whatsapp": number},
    "advisorEffectiveness": [{"advisor": "string", "interactions": number, "industry": "string"}]
  },

  "s5_recovery_engine": {
    "paymentRecoveries": "string or null — from payment recovery data if available",
    "abandonedWorkflows": "string or null",
    "customerRetentionSaves": "string — from memory vault retention-type memories",
    "aiInterventionCount": number_or_null,
    "recoveredRevenueEstimate": "string — honest estimate or 'Insufficient data'",
    "preventedChurnValue": "string — estimate based on active user count × average plan value",
    "operationalContinuity": "string — uptime/availability value statement"
  },

  "s6_industry_advisor_insights": [
    {
      "industry": "string",
      "advisor": "string",
      "interactions": number,
      "memoriesExtracted": 0,
      "topInsight": "specific insight from memory vault for this industry or 'No memory data yet'",
      "performanceNote": "honest performance note"
    }
  ],

  "s7_sherlock_strategic_notes": "3-5 paragraphs. Owner-level strategic analysis. What is the platform's real state? What decisions need attention? What is working? What is at risk? Be direct — Nauman trusts you for honesty.",

  "s8_growth_recommendations": {
    "strategicGrowthRec": {
      "title": "max 8 words",
      "detail": "2-3 sentences — specific, actionable, data-backed",
      "estimatedImpact": "honest revenue impact range"
    },
    "operationalWarning": {
      "title": "max 8 words",
      "detail": "2-3 sentences — what could go wrong and why",
      "urgency": "immediate | this_week | this_month"
    },
    "missedOpportunity": {
      "title": "max 8 words",
      "detail": "2-3 sentences — what is being left on the table",
      "potentialValue": "honest value estimate"
    },
    "revenueOptimization": {
      "title": "max 8 words",
      "prediction": "seasonal or behavioral revenue prediction based on data/memory",
      "triggerCondition": "what needs to happen to realize this"
    }
  },

  "s9_forecast_next_month": {
    "expectedGrowthRange": "string — e.g. '8–14% engagement growth' — be conservative and honest",
    "keyDrivers": ["string array — 2-3 specific growth drivers"],
    "watchItems": ["string array — 2-3 risks to monitor"],
    "recommendedActions": ["string array — 3 specific actions for next month"],
    "confidenceLevel": 0-100
  },

  "s10_net_business_impact": {
    "totalRevenueImpact": "string — total estimated revenue generated/influenced",
    "totalCostSavings": "string — total estimated savings",
    "totalROIEstimate": "string — e.g. '~6.2x ROI this period (estimated)' — be conservative",
    "hostflowValueScore": 0-100,
    "verdictOneLiner": "one sentence — what HostFlow AI delivered this period",
    "keyWin": "single biggest win this period — specific and honest"
  }
}`;

  const res = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: "Generate the Revenue Intelligence Report now." },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "{}";
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { parse_error: "Sherlock response could not be parsed", raw: raw.slice(0, 500) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Format plain-text email version of the report
// ─────────────────────────────────────────────────────────────────────────────
function formatEmailReport(sections: Record<string, unknown>, periodLabel: string): string {
  const s1  = sections["s1_executive_summary"] as string ?? "";
  const s7  = sections["s7_sherlock_strategic_notes"] as string ?? "";
  const s2  = sections["s2_revenue_impact"] as Record<string, unknown> ?? {};
  const s3  = sections["s3_cost_savings"] as Record<string, unknown> ?? {};
  const s4  = sections["s4_ai_resolution_metrics"] as Record<string, unknown> ?? {};
  const s8  = sections["s8_growth_recommendations"] as Record<string, unknown> ?? {};
  const s9  = sections["s9_forecast_next_month"] as Record<string, unknown> ?? {};
  const s10 = sections["s10_net_business_impact"] as Record<string, unknown> ?? {};

  const rec = s8["strategicGrowthRec"] as Record<string, unknown> ?? {};
  const warn = s8["operationalWarning"] as Record<string, unknown> ?? {};
  const miss = s8["missedOpportunity"] as Record<string, unknown> ?? {};
  const pred = s8["revenueOptimization"] as Record<string, unknown> ?? {};

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOSTFLOW AI — REVENUE INTELLIGENCE REPORT
${periodLabel.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EXECUTIVE SUMMARY
${s1}

━━━━━━━━━━━━━━━━━━
2. REVENUE IMPACT
━━━━━━━━━━━━━━━━━━
Revenue Growth:      ${s2["revenueGrowthEstimate"] ?? "N/A"}
Booking Increases:   ${s2["bookingIncreases"] ?? "N/A"}
AI-Assisted Upsells: ${s2["aiAssistedUpsells"] ?? "N/A"}
Repeat Customer:     ${s2["repeatCustomerGrowth"] ?? "N/A"}
TOTAL IMPACT:        ${s2["totalRevenueImpact"] ?? "N/A"}
Note: ${s2["confidenceNote"] ?? ""}

━━━━━━━━━━━━━━━━━━
3. COST SAVINGS
━━━━━━━━━━━━━━━━━━
vs Marketplace Fees: ${s3["vsMarketplaceFees"] ?? "N/A"}
vs Manual Support:   ${s3["vsManualSupport"] ?? "N/A"}
vs External AI CRM:  ${s3["vsExternalAICRM"] ?? "N/A"}
Automation Impact:   ${s3["automationImpact"] ?? "N/A"}
TOTAL SAVINGS:       ${s3["totalSavingsEstimate"] ?? "N/A"} (confidence: ${s3["savingsConfidence"] ?? "N/A"}%)

━━━━━━━━━━━━━━━━━━
4. AI RESOLUTION METRICS
━━━━━━━━━━━━━━━━━━
AI Calls This Period:   ${s4["totalAiCallsThisPeriod"] ?? "N/A"}
Avg Resolution Time:    ${s4["avgResolutionTime"] ?? "N/A"}
AI-First Resolution:    ${s4["aiFirstResolutionRate"] ?? "N/A"}
Sherlock Escalations:   ${s4["sherlockEscalationRate"] ?? "N/A"}
Automation Rate:        ${s4["automationPercentage"] ?? "N/A"}
Engagement Trend:       ${s4["engagementTrend"] ?? "N/A"}

━━━━━━━━━━━━━━━━━━
7. SHERLOCK STRATEGIC NOTES
━━━━━━━━━━━━━━━━━━
${s7}

━━━━━━━━━━━━━━━━━━
8. GROWTH RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━
▶ STRATEGIC GROWTH: ${rec["title"] ?? ""}
  ${rec["detail"] ?? ""}
  Estimated impact: ${rec["estimatedImpact"] ?? ""}

⚠ OPERATIONAL WARNING: ${warn["title"] ?? ""}
  ${warn["detail"] ?? ""}
  Urgency: ${warn["urgency"] ?? ""}

◆ MISSED OPPORTUNITY: ${miss["title"] ?? ""}
  ${miss["detail"] ?? ""}
  Potential value: ${miss["potentialValue"] ?? ""}

◈ REVENUE PREDICTION: ${pred["title"] ?? ""}
  ${pred["prediction"] ?? ""}
  Trigger: ${pred["triggerCondition"] ?? ""}

━━━━━━━━━━━━━━━━━━
9. FORECAST NEXT MONTH
━━━━━━━━━━━━━━━━━━
Expected Growth: ${s9["expectedGrowthRange"] ?? "N/A"}
Confidence: ${s9["confidenceLevel"] ?? "N/A"}%
Key Drivers: ${(s9["keyDrivers"] as string[] ?? []).join(" | ")}
Watch Items: ${(s9["watchItems"] as string[] ?? []).join(" | ")}
Actions: ${(s9["recommendedActions"] as string[] ?? []).join(" | ")}

━━━━━━━━━━━━━━━━━━
10. NET BUSINESS IMPACT
━━━━━━━━━━━━━━━━━━
Revenue Impact:     ${s10["totalRevenueImpact"] ?? "N/A"}
Cost Savings:       ${s10["totalCostSavings"] ?? "N/A"}
ROI Estimate:       ${s10["totalROIEstimate"] ?? "N/A"}
HostFlow Value:     ${s10["hostflowValueScore"] ?? "N/A"}/100
Key Win:            ${s10["keyWin"] ?? "N/A"}

${s10["verdictOneLiner"] ?? ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sherlock | HostFlow AI Revenue Intelligence Engine
Generated: ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — generate, store, optionally email
// ─────────────────────────────────────────────────────────────────────────────
export async function generateIntelligenceReport(
  opts: GenerateReportOptions,
  log?: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void }
): Promise<{ id: number; status: "ready" | "error" }> {

  const { db, intelligenceReports } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");

  // Insert as generating
  const [inserted] = await db.insert(intelligenceReports).values({
    periodLabel:  opts.periodLabel,
    periodType:   opts.periodType,
    periodStart:  opts.periodStart,
    periodEnd:    opts.periodEnd,
    status:       "generating",
    generatedBy:  opts.generatedBy,
  }).returning({ id: intelligenceReports.id });

  const reportId = inserted!.id;
  log?.info({ reportId, period: opts.periodLabel }, "Intelligence report generation started");

  try {
    // Step 1 — collect platform data
    const { collectPlatformData } = await import("./intelligence-data-collector.js");
    const data = await collectPlatformData(opts.periodStart, opts.periodEnd, opts.periodLabel, opts.periodType);
    log?.info({ qualityScore: data.dataQuality.score, aiCalls: data.aiUsage.callsThisPeriod }, "Platform data collected");

    // Step 2 — Sherlock generates all 10 sections
    const sections = await generateWithSherlock(data);
    log?.info({ reportId }, "Sherlock analysis complete");

    const s4 = sections["s4_ai_resolution_metrics"] as Record<string, unknown> ?? {};
    const s10 = sections["s10_net_business_impact"] as Record<string, unknown> ?? {};
    const confidenceScore = (s10["hostflowValueScore"] as number) ?? data.dataQuality.score;

    type IR = typeof intelligenceReports.$inferSelect;
    type J<K extends keyof IR> = IR[K];

    // Step 3 — store full report
    await db.update(intelligenceReports)
      .set({
        s1ExecutiveSummary:        (sections["s1_executive_summary"] as string) ?? null,
        s2RevenueImpact:           (sections["s2_revenue_impact"] as unknown)   as J<"s2RevenueImpact">    ?? null,
        s3CostSavings:             (sections["s3_cost_savings"] as unknown)     as J<"s3CostSavings">      ?? null,
        s4AiResolutionMetrics:     (sections["s4_ai_resolution_metrics"] as unknown) as J<"s4AiResolutionMetrics"> ?? null,
        s5RecoveryEngine:          (sections["s5_recovery_engine"] as unknown)  as J<"s5RecoveryEngine">   ?? null,
        s6IndustryAdvisorInsights: (sections["s6_industry_advisor_insights"] as unknown) as J<"s6IndustryAdvisorInsights"> ?? null,
        s7SherlockStrategicNotes:  (sections["s7_sherlock_strategic_notes"] as string) ?? null,
        s8GrowthRecommendations:   (sections["s8_growth_recommendations"] as unknown) as J<"s8GrowthRecommendations"> ?? null,
        s9ForecastNextMonth:       (sections["s9_forecast_next_month"] as unknown) as J<"s9ForecastNextMonth"> ?? null,
        s10NetBusinessImpact:      (sections["s10_net_business_impact"] as unknown) as J<"s10NetBusinessImpact"> ?? null,
        dataSnapshot: {
          totalSubscriptions:  data.subscriptions.total,
          activeUsers:         data.subscriptions.active,
          trialUsers:          data.subscriptions.trial,
          totalAiCalls:        data.aiUsage.callsThisPeriod,
          totalConversations:  data.conversations.newThisPeriod,
          totalMemories:       data.memory.newThisPeriod,
          totalCustomer360:    data.memory.customer360Count,
          totalKnowledgeNodes: data.knowledgeGraph.totalNodes,
          externalReportsCount: data.externalReports.count,
          periodStart:         opts.periodStart.toISOString(),
          periodEnd:           opts.periodEnd.toISOString(),
        },
        confidenceScore,
        dataQualityNote:  data.dataQuality.note,
        status:           "ready",
        updatedAt:        sql`now()`,
      })
      .where(sql`id = ${reportId}`);

    // Step 4 — email to Nauman if requested
    if (opts.sendEmail) {
      try {
        const { sendMail } = await import("./mailer.js");
        const emailText = formatEmailReport(sections, opts.periodLabel);
        const result = await sendMail({
          to:       FOUNDER_EMAIL,
          subject:  `HostFlow AI — Revenue Intelligence Report | ${opts.periodLabel}`,
          text:     emailText,
          identity: "revenue",
        });

        if (result.success) {
          await db.update(intelligenceReports)
            .set({ emailedTo: FOUNDER_EMAIL, emailedAt: sql`now()`, updatedAt: sql`now()` })
            .where(sql`id = ${reportId}`);
          log?.info({ reportId, messageId: result.messageId }, "Intelligence report emailed to Nauman");
        }
      } catch (emailErr) {
        log?.error({ err: emailErr, reportId }, "Email delivery failed — report still saved");
      }
    }

    log?.info({ reportId, status: "ready", confidence: confidenceScore }, "Intelligence report complete");
    return { id: reportId, status: "ready" };

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    log?.error({ err: e, reportId }, "Intelligence report generation failed");

    const { sql: sqlFail } = await import("drizzle-orm");
    await db.update(intelligenceReports)
      .set({ status: "error", processingError: errMsg.slice(0, 500), updatedAt: sqlFail`now()` })
      .where(sqlFail`id = ${reportId}`);

    return { id: reportId, status: "error" };
  }
}
