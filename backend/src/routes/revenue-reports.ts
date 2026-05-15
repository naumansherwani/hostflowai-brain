// ─────────────────────────────────────────────────────────────────────────────
// Revenue Reports API
// Founder-only endpoints for the Owner Dashboard Revenue Report section
//
// GET  /api/revenue-reports              — list all reports (paginated)
// POST /api/revenue-reports              — manually submit a report
// GET  /api/revenue-reports/summary      — dashboard summary (cards + chart data)
// GET  /api/revenue-reports/:id          — single report full detail
// POST /api/revenue-reports/:id/reanalyze — re-run Sherlock analysis
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";
import { processRevenueReport } from "../lib/revenue-report-processor.js";
import { runMonthlyReports } from "../lib/monthly-report-generator.js";

const router: IRouter = Router();

const FOUNDER_USER_ID = "d089432d-5d6b-416e-bd29-abe913121d99";

// ─── Guard: founder-only access ──────────────────────────────────────────────
function requireFounder(req: Request, res: Response): boolean {
  const userId = req.user?.sub;
  if (!userId || userId !== FOUNDER_USER_ID) {
    res.status(403).json(err("FORBIDDEN", "Revenue reports are restricted to the founder account.", req.trace_id));
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/revenue-reports/summary
// Aggregated dashboard data — metric cards + monthly chart series
// MUST be before /:id to avoid route collision
// ─────────────────────────────────────────────────────────────────────────────
router.get("/revenue-reports/summary", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  try {
    const { db, revenueReports } = await import("@workspace/db");
    const { sql, desc, gte } = await import("drizzle-orm");

    // Last 12 months
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const [all, recent12] = await Promise.all([
      db.select({
        industry:       revenueReports.industry,
        totalRevenue:   revenueReports.totalRevenue,
        previousRevenue: revenueReports.previousRevenue,
        growthRate:     revenueReports.growthRate,
        periodLabel:    revenueReports.periodLabel,
        periodType:     revenueReports.periodType,
        currency:       revenueReports.currency,
        status:         revenueReports.status,
        createdAt:      revenueReports.createdAt,
      }).from(revenueReports).orderBy(desc(revenueReports.createdAt)),

      db.select({
        industry:     revenueReports.industry,
        totalRevenue: revenueReports.totalRevenue,
        growthRate:   revenueReports.growthRate,
        periodLabel:  revenueReports.periodLabel,
        currency:     revenueReports.currency,
        createdAt:    revenueReports.createdAt,
      }).from(revenueReports)
        .where(gte(revenueReports.createdAt, since))
        .orderBy(desc(revenueReports.createdAt)),
    ]);

    const processed = all.filter(r => r.status === "processed");

    // Aggregate revenue across all processed reports
    const totalRevenueSum = processed.reduce((s, r) => s + (parseFloat(r.totalRevenue ?? "0") || 0), 0);
    const reportsWithGrowth = processed.filter(r => r.growthRate != null);
    const avgGrowth = reportsWithGrowth.length
      ? reportsWithGrowth.reduce((s, r) => s + (parseFloat(r.growthRate ?? "0") || 0), 0) / reportsWithGrowth.length
      : null;

    // Best performing industry by total revenue
    const byIndustry: Record<string, number> = {};
    for (const r of processed) {
      if (!r.industry || r.industry === "unknown") continue;
      byIndustry[r.industry] = (byIndustry[r.industry] ?? 0) + (parseFloat(r.totalRevenue ?? "0") || 0);
    }
    const topIndustry = Object.entries(byIndustry).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Monthly chart series (last 12 months)
    const chartSeries = recent12.map(r => ({
      period:       r.periodLabel,
      revenue:      parseFloat(r.totalRevenue ?? "0") || 0,
      growth:       r.growthRate != null ? parseFloat(r.growthRate) : null,
      industry:     r.industry,
      currency:     r.currency,
    })).reverse();

    // Industry breakdown
    const industryBreakdown = Object.entries(byIndustry)
      .map(([industry, revenue]) => ({ industry, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    // Count by status
    const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` })
      .from(revenueReports).where(sql`status = 'pending'`);

    res.json(ok({
      cards: {
        totalRevenue:     +totalRevenueSum.toFixed(2),
        totalReports:     all.length,
        processedReports: processed.length,
        pendingReports:   pending,
        avgGrowthRate:    avgGrowth != null ? +avgGrowth.toFixed(2) : null,
        topIndustry,
      },
      chartSeries,
      industryBreakdown,
      recentReports: all.slice(0, 5).map(r => ({
        periodLabel:  r.periodLabel,
        industry:     r.industry,
        totalRevenue: r.totalRevenue,
        growthRate:   r.growthRate,
        currency:     r.currency,
        status:       r.status,
        createdAt:    r.createdAt,
      })),
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Revenue reports summary failed");
    res.status(500).json(err("INTERNAL_ERROR", "Could not fetch revenue summary.", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/revenue-reports  — paginated list
// ─────────────────────────────────────────────────────────────────────────────
router.get("/revenue-reports", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  try {
    const { db, revenueReports } = await import("@workspace/db");
    const { desc, sql, eq } = await import("drizzle-orm");

    const page     = Math.max(1, parseInt(req.query["page"] as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query["pageSize"] as string) || 20));
    const industry = req.query["industry"] as string | undefined;
    const status   = req.query["status"]   as string | undefined;

    // Build query dynamically
    const baseQuery = db.select({
      id:            revenueReports.id,
      submittedBy:   revenueReports.submittedBy,
      submitterName: revenueReports.submitterName,
      businessName:  revenueReports.businessName,
      periodLabel:   revenueReports.periodLabel,
      periodType:    revenueReports.periodType,
      industry:      revenueReports.industry,
      source:        revenueReports.source,
      totalRevenue:  revenueReports.totalRevenue,
      growthRate:    revenueReports.growthRate,
      currency:      revenueReports.currency,
      aiSummary:     revenueReports.aiSummary,
      aiConfidence:  revenueReports.aiConfidence,
      status:        revenueReports.status,
      createdAt:     revenueReports.createdAt,
    }).from(revenueReports);

    const filters = [];
    if (industry) filters.push(eq(revenueReports.industry, industry));
    if (status)   filters.push(eq(revenueReports.status, status));

    const { and } = await import("drizzle-orm");

    const rows = await (filters.length
      ? baseQuery.where(and(...filters))
      : baseQuery
    )
      .orderBy(desc(revenueReports.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(revenueReports);

    res.json(ok({
      reports:    rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Revenue reports list failed");
    res.status(500).json(err("INTERNAL_ERROR", "Could not fetch reports.", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revenue-reports  — manual submission
// Body: { subject, rawContent, source?, submitterName? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/revenue-reports", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  const { subject, rawContent, submitterName } = req.body as {
    subject?:       string;
    rawContent?:    string;
    submitterName?: string;
  };

  if (!rawContent?.trim()) {
    res.status(400).json(err("VALIDATION_ERROR", "rawContent is required.", req.trace_id));
    return;
  }

  try {
    const result = await processRevenueReport(
      {
        submittedBy:   req.user!.sub,
        submitterName: submitterName ?? req.user?.email ?? "Dashboard",
        subject:       subject ?? "Manual Report",
        rawContent,
        source:        "manual",
      },
      req.log,
    );

    res.status(result.status === "processed" ? 201 : 202).json(ok({
      id:     result.id,
      status: result.status,
      message: result.status === "processed"
        ? "Report processed and analyzed by Sherlock."
        : "Report saved — processing failed. Check logs.",
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Manual revenue report submission failed");
    res.status(500).json(err("INTERNAL_ERROR", "Report submission failed.", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/revenue-reports/:id  — full report detail
// ─────────────────────────────────────────────────────────────────────────────
router.get("/revenue-reports/:id", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) {
    res.status(400).json(err("VALIDATION_ERROR", "Invalid report ID.", req.trace_id));
    return;
  }

  try {
    const { db, revenueReports } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [report] = await db.select().from(revenueReports).where(eq(revenueReports.id, id));
    if (!report) {
      res.status(404).json(err("NOT_FOUND", "Report not found.", req.trace_id));
      return;
    }

    res.json(ok(report, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Revenue report fetch failed");
    res.status(500).json(err("INTERNAL_ERROR", "Could not fetch report.", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revenue-reports/send-monthly
// Sherlock sends personalized monthly intelligence briefing to ALL active users
// Founder-only. Fire-and-forget batch job — returns immediately with job status.
// Body: { month?: string, user_ids?: string[], dry_run?: boolean }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/revenue-reports/send-monthly", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  const { month, user_ids, dry_run } = req.body as {
    month?:     string;
    user_ids?:  string[];
    dry_run?:   boolean;
  };

  const isDry = dry_run === true;

  if (!process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured.", req.trace_id));
    return;
  }
  if (!process.env["RESEND_API_KEY"] && !isDry) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "Email not configured — add RESEND_API_KEY.", req.trace_id));
    return;
  }

  req.log.info({ month, userCount: user_ids?.length ?? "all", dryRun: isDry }, "Monthly briefing job triggered");

  // Run async — don't block the HTTP response
  runMonthlyReports({ month, userIds: user_ids, dryRun: isDry, log: req.log })
    .then(result => {
      req.log.info(result, "Monthly briefing job complete");
    })
    .catch(e => {
      req.log.error({ err: e }, "Monthly briefing job failed");
    });

  res.status(202).json(ok({
    status:    "accepted",
    message:   isDry
      ? "Dry run started — no emails will be sent. Check server logs."
      : "Monthly briefing job started. Sherlock is generating and sending personalized reports.",
    dry_run:   isDry,
    month:     month ?? new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
    triggered_at: new Date().toISOString(),
  }, req.trace_id));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revenue-reports/:id/reanalyze  — re-run Sherlock on existing report
// ─────────────────────────────────────────────────────────────────────────────
router.post("/revenue-reports/:id/reanalyze", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;

  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) {
    res.status(400).json(err("VALIDATION_ERROR", "Invalid report ID.", req.trace_id));
    return;
  }

  if (!process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured.", req.trace_id));
    return;
  }

  try {
    const { db, revenueReports } = await import("@workspace/db");
    const { eq, sql } = await import("drizzle-orm");

    const [report] = await db.select({
      id:          revenueReports.id,
      rawContent:  revenueReports.rawContent,
      periodLabel: revenueReports.periodLabel,
      industry:    revenueReports.industry,
      currency:    revenueReports.currency,
      parsedMetrics: revenueReports.parsedMetrics,
    }).from(revenueReports).where(eq(revenueReports.id, id));

    if (!report) {
      res.status(404).json(err("NOT_FOUND", "Report not found.", req.trace_id));
      return;
    }

    // Reset to pending so the processor re-runs cleanly
    await db.update(revenueReports)
      .set({ status: "pending", processingError: null, updatedAt: sql`now()` })
      .where(eq(revenueReports.id, id));

    const result = await processRevenueReport(
      {
        submittedBy:   req.user!.sub,
        submitterName: "Reanalysis",
        subject:       `Reanalysis of report #${id}`,
        rawContent:    report.rawContent,
        source:        "api",
      },
      req.log,
    );

    res.json(ok({
      id:     report.id,
      status: result.status,
      message: "Sherlock reanalysis complete.",
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Revenue report reanalysis failed");
    res.status(500).json(err("INTERNAL_ERROR", "Reanalysis failed.", req.trace_id));
  }
});

export default router;
