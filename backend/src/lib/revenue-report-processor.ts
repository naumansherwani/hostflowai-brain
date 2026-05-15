// ─────────────────────────────────────────────────────────────────────────────
// Revenue Report Processor
// 1. Receives raw email/text content
// 2. AI extracts structured financial metrics
// 3. Sherlock generates executive analysis + prioritized insights
// 4. Stores everything in revenue_reports table
// ─────────────────────────────────────────────────────────────────────────────

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

const REVENUE_EMAIL = "revenuereport@hostflowai.net";

export interface RevenueReportInput {
  submittedBy:    string;
  submitterName:  string;
  subject:        string;
  rawContent:     string;
  source:         "email" | "manual" | "api";
  emailMessageId?: string;
}

interface ParsedMetrics {
  totalRevenue?:       number;
  previousRevenue?:    number;
  growthRate?:         number;
  occupancyRate?:      number;
  avgDailyRate?:       number;
  totalBookings?:      number;
  cancellations?:      number;
  topRevenueStream?:   string;
  costOfGoods?:        number;
  grossProfit?:        number;
  currency?:           string;
  additionalMetrics?:  Record<string, number | string>;
}

interface SherlockAnalysis {
  summary:     string;
  insights:    Array<{
    type:     "opportunity" | "risk" | "trend" | "action";
    priority: "critical" | "high" | "medium" | "low";
    title:    string;
    detail:   string;
    impact?:  string;
  }>;
  confidence:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Extract structured metrics from raw content
// ─────────────────────────────────────────────────────────────────────────────
async function extractMetrics(subject: string, rawContent: string): Promise<{
  metrics:       ParsedMetrics;
  periodLabel:   string;
  periodType:    "monthly" | "quarterly" | "yearly" | "custom";
  businessName:  string;
  industry:      string;
  currency:      string;
}> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL!, apiKey: AI_API_KEY! });

  const systemPrompt = `You are a financial data extraction AI. Extract ALL financial metrics from the provided business report.

Return ONLY valid JSON — no explanation, no markdown.

Required JSON structure:
{
  "periodLabel": "string — e.g. April 2026 or Q1 2026",
  "periodType": "monthly|quarterly|yearly|custom",
  "businessName": "string — company/business name if mentioned",
  "industry": "one of: tourism_hospitality|airlines|car_rental|healthcare|education|logistics|events_entertainment|railways|unknown",
  "currency": "USD|PKR|AED|EUR|GBP|INR|SAR — detect from content or default USD",
  "metrics": {
    "totalRevenue": number_or_null,
    "previousRevenue": number_or_null,
    "growthRate": number_or_null,
    "occupancyRate": number_or_null,
    "avgDailyRate": number_or_null,
    "totalBookings": number_or_null,
    "cancellations": number_or_null,
    "topRevenueStream": "string_or_null",
    "costOfGoods": number_or_null,
    "grossProfit": number_or_null,
    "additionalMetrics": {}
  }
}

All monetary values as plain numbers (no currency symbols, no commas).
If a metric is not mentioned, use null.`;

  const res = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: `Subject: ${subject}\n\n${rawContent}` },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "{}";
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      metrics:      parsed.metrics      ?? {},
      periodLabel:  parsed.periodLabel  ?? "Unknown Period",
      periodType:   parsed.periodType   ?? "custom",
      businessName: parsed.businessName ?? "",
      industry:     parsed.industry     ?? "unknown",
      currency:     parsed.currency     ?? "USD",
    };
  } catch {
    return {
      metrics: {}, periodLabel: "Unknown Period", periodType: "custom",
      businessName: "", industry: "unknown", currency: "USD",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Sherlock AI Analysis
// ─────────────────────────────────────────────────────────────────────────────
async function runSherlockAnalysis(
  rawContent:  string,
  metrics:     ParsedMetrics,
  periodLabel: string,
  industry:    string,
  currency:    string,
): Promise<SherlockAnalysis> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL!, apiKey: AI_API_KEY! });

  const systemPrompt = `You are Sherlock, the owner-level AI business advisor at HostFlow AI.
You report directly to Muhammad Nauman Sherwani (Founder & Chairman).

You have received a revenue report from a client in the ${industry} industry.
Period: ${periodLabel}
Currency: ${currency}

Parsed metrics:
${JSON.stringify(metrics, null, 2)}

Full report:
${rawContent.slice(0, 3000)}

Provide a strategic executive analysis. Return ONLY valid JSON:
{
  "summary": "3-4 sentence executive summary — performance verdict, key driver, and one bold recommendation",
  "insights": [
    {
      "type": "opportunity|risk|trend|action",
      "priority": "critical|high|medium|low",
      "title": "short title (max 8 words)",
      "detail": "specific actionable detail (2-3 sentences)",
      "impact": "estimated revenue impact if actioned — e.g. +15% RevPAR or PKR 2.4M additional"
    }
  ],
  "confidence": 0-100
}

Rules:
- Generate 4-6 insights minimum
- At least 1 "critical" or "high" priority item
- insights must be SPECIFIC to the data — no generic advice
- impact estimates must be realistic and industry-specific`;

  const res = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: "Analyze this revenue report." },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "{}";
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary:    parsed.summary    ?? "Analysis unavailable.",
      insights:   parsed.insights   ?? [],
      confidence: parsed.confidence ?? 70,
    };
  } catch {
    return { summary: "Analysis parsing failed — raw content stored.", insights: [], confidence: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processor — called from email route or API
// Returns the created report ID
// ─────────────────────────────────────────────────────────────────────────────
export async function processRevenueReport(
  input: RevenueReportInput,
  log?: { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void }
): Promise<{ id: number; status: "processed" | "error" }> {

  const { db, revenueReports } = await import("@workspace/db");

  // Insert initial record as pending
  const [inserted] = await db.insert(revenueReports).values({
    submittedBy:    input.submittedBy,
    submitterName:  input.submitterName,
    businessName:   "",
    periodLabel:    "Processing…",
    periodType:     "custom",
    industry:       "unknown",
    source:         input.source,
    emailMessageId: input.emailMessageId ?? null,
    rawContent:     input.rawContent.slice(0, 10_000),
    currency:       "USD",
    status:         "pending",
  }).returning({ id: revenueReports.id });

  const reportId = inserted!.id;
  log?.info({ reportId, source: input.source }, "Revenue report created — processing");

  try {
    // Step 1 — extract metrics
    const extracted = await extractMetrics(input.subject, input.rawContent);
    log?.info({ periodLabel: extracted.periodLabel, industry: extracted.industry }, "Metrics extracted");

    // Step 2 — Sherlock analysis
    const analysis = await runSherlockAnalysis(
      input.rawContent,
      extracted.metrics,
      extracted.periodLabel,
      extracted.industry,
      extracted.currency,
    );
    log?.info({ confidence: analysis.confidence, insightCount: analysis.insights.length }, "Sherlock analysis complete");

    const totalRevenue    = extracted.metrics.totalRevenue ?? null;
    const previousRevenue = extracted.metrics.previousRevenue ?? null;
    const growthRate      = extracted.metrics.growthRate
      ?? (totalRevenue && previousRevenue && previousRevenue !== 0
        ? +((((totalRevenue - previousRevenue) / previousRevenue) * 100).toFixed(2))
        : null);

    const { sql } = await import("drizzle-orm");

    await db.update(revenueReports)
      .set({
        businessName:    extracted.businessName || null,
        periodLabel:     extracted.periodLabel,
        periodType:      extracted.periodType,
        industry:        extracted.industry,
        currency:        extracted.currency,
        parsedMetrics:   extracted.metrics,
        totalRevenue:    totalRevenue?.toString()    ?? null,
        previousRevenue: previousRevenue?.toString() ?? null,
        growthRate:      growthRate?.toString()      ?? null,
        aiSummary:       analysis.summary,
        aiInsights:      analysis.insights,
        aiConfidence:    analysis.confidence,
        status:          "processed",
        processedAt:     sql`now()`,
        updatedAt:       sql`now()`,
      })
      .where(sql`id = ${reportId}`);

    log?.info({ reportId }, "Revenue report fully processed");
    return { id: reportId, status: "processed" };

  } catch (e) {
    const { sql } = await import("drizzle-orm");
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    log?.error({ err: e, reportId }, "Revenue report processing failed");

    await db.update(revenueReports)
      .set({ status: "error", processingError: errMsg.slice(0, 500), updatedAt: sql`now()` })
      .where(sql`id = ${reportId}`);

    return { id: reportId, status: "error" };
  }
}

export { REVENUE_EMAIL };
