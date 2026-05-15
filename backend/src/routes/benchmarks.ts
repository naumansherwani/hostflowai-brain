// ─────────────────────────────────────────────────────────────────────────────
// AI Benchmark Intelligence — Industry Comparison Engine
// Compares a user's engagement/health metrics against anonymized industry avg.
// Min 3 users needed per industry to show benchmarks (privacy protection).
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { eq, avg, count, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { ok, err } from "../lib/response.js";
import { logger } from "../lib/logger.js";

const router = Router();
const FOUNDER_ID    = "d089432d-5d6b-416e-bd29-abe913121d99";
const MIN_SAMPLE    = 3; // privacy floor

function isoWeek(): string {
  const d    = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Recalculate benchmarks for all industries ─────────────────────────────────
export async function recalculateBenchmarks(): Promise<void> {
  try {
    const {
      db, industryBenchmarks, userHealthScores, aiResolutionIssues,
    } = await import("@workspace/db");

    const period = isoWeek();

    // Aggregate per industry from health scores
    const aggRows = await db
      .select({
        industry:        userHealthScores.industry,
        sampleSize:      count(),
        avgHealthScore:  avg(userHealthScores.healthScore),
        avgEngagement:   avg(userHealthScores.engagementScore),
        avgIssueScore:   avg(userHealthScores.issueScore),
        avgUsageScore:   avg(userHealthScores.usageScore),
      })
      .from(userHealthScores)
      .groupBy(userHealthScores.industry);

    for (const row of aggRows) {
      if ((row.sampleSize ?? 0) < MIN_SAMPLE) continue; // privacy — skip small samples

      // Top issues for this industry
      const issueRows = await db
        .select({
          issueType:  aiResolutionIssues.issueType,
          cnt:        count(),
        })
        .from(aiResolutionIssues)
        .where(eq(aiResolutionIssues.industry, row.industry))
        .groupBy(aiResolutionIssues.issueType)
        .orderBy(sql`count(*) DESC`)
        .limit(5);

      const topIssues = issueRows.map(i => ({
        topic: i.issueType,
        count: i.cnt,
      }));

      const metrics = [
        { metric: "health_score",   avg: parseFloat(row.avgHealthScore ?? "0"),  unit: "/100",   label: "Avg Health Score" },
        { metric: "engagement",     avg: parseFloat(row.avgEngagement ?? "0"),   unit: "/100",   label: "Avg Engagement Score" },
        { metric: "issue_score",    avg: parseFloat(row.avgIssueScore ?? "0"),   unit: "/100",   label: "Avg Issue Resolution Score" },
        { metric: "usage_score",    avg: parseFloat(row.avgUsageScore ?? "0"),   unit: "/100",   label: "Avg AI Usage Score" },
      ];

      await db
        .insert(industryBenchmarks)
        .values({
          industry:        row.industry,
          period,
          sampleSize:      row.sampleSize ?? 0,
          metrics,
          avgHealthScore:  row.avgHealthScore ?? "0",
          topIssues,
        })
        .onConflictDoUpdate({
          target:  [industryBenchmarks.industry, industryBenchmarks.period],
          set: {
            sampleSize:    row.sampleSize ?? 0,
            metrics,
            avgHealthScore: row.avgHealthScore ?? "0",
            topIssues,
            calculatedAt:  new Date(),
          },
        });
    }

    logger.info({ period }, "Benchmarks recalculated");
  } catch (e) {
    logger.warn({ err: e }, "recalculateBenchmarks failed — non-fatal");
  }
}

// ── GET /api/benchmarks/:industry — get latest benchmark for an industry ──────
router.get("/:industry", requireAuth, requireSurface("dashboard"), async (req, res) => {
  const industry = req.params["industry"] as string;
  const { db, industryBenchmarks, userHealthScores } = await import("@workspace/db");

  // Latest benchmark
  const [bench] = await db
    .select()
    .from(industryBenchmarks)
    .where(eq(industryBenchmarks.industry, industry))
    .orderBy(sql`calculated_at DESC`)
    .limit(1);

  // User's own score for comparison
  const userId = req.user!.sub;
  const [userScore] = await db
    .select()
    .from(userHealthScores)
    .where(eq(userHealthScores.userId, userId))
    .limit(1);

  if (!bench || (bench.sampleSize ?? 0) < MIN_SAMPLE) {
    return res.json(ok({
      industry,
      benchmarkAvailable: false,
      reason: "Not enough users in this industry for anonymized benchmarks yet.",
      yourScore: userScore ?? null,
    }));
  }

  // Build comparison
  const metrics   = (bench.metrics as Array<{ metric: string; avg: number; unit: string; label: string }>);
  const comparison = metrics.map(m => {
    const userVal = userScore
      ? (m.metric === "health_score"   ? userScore.healthScore
       : m.metric === "engagement"     ? userScore.engagementScore
       : m.metric === "issue_score"    ? userScore.issueScore
       : m.metric === "usage_score"    ? userScore.usageScore
       : null)
      : null;

    const gap    = userVal !== null ? +(userVal - m.avg).toFixed(1) : null;
    const status = gap === null ? "unknown" : gap >= 5 ? "above_avg" : gap >= -5 ? "on_par" : "below_avg";
    return { ...m, yourValue: userVal, gap, status };
  });

  return res.json(ok({
    industry,
    period:          bench.period,
    sampleSize:      bench.sampleSize,
    benchmarkAvailable: true,
    comparison,
    topIssues:       bench.topIssues,
    calculatedAt:    bench.calculatedAt,
  }));
});

// ── GET /api/benchmarks — all industries summary (founder only) ───────────────
router.get("/", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, industryBenchmarks } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(industryBenchmarks)
    .orderBy(sql`calculated_at DESC`);

  return res.json(ok({ total: rows.length, benchmarks: rows }));
});

// ── POST /api/benchmarks/recalculate — force recalculate all (founder only) ───
router.post("/recalculate", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  await recalculateBenchmarks();
  return res.json(ok({ message: "Benchmarks recalculated for all industries." }));
});

export { router as benchmarksRouter };
