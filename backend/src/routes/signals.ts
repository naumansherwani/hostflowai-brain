// ─────────────────────────────────────────────────────────────────────────────
// Cross-Industry Pattern Intelligence — Product Signals (Sherlock-level)
// Detects patterns from advisor conversations weekly.
// Alerts Nauman bhai: "5 airlines clients asked about crew scheduling."
// Drives product roadmap without ever running a survey.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { desc, eq, and, gte, sql, count } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";
import { logger } from "../lib/logger.js";
import { notifyFounderP0 } from "../lib/notify-founder.js";

const router = Router();
const FOUNDER_ID = "d089432d-5d6b-416e-bd29-abe913121d99";

function isoWeek(): string {
  const d    = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Topic keywords to detect from conversation content
const TOPIC_KEYWORDS: Record<string, string[]> = {
  crew_scheduling:      ["crew", "schedule", "roster", "pilot", "staff roster", "shift"],
  double_booking:       ["double book", "double-book", "overbooking", "conflict", "clash"],
  payment_failure:      ["payment fail", "payment declined", "card declined", "refund", "chargeback"],
  dynamic_pricing:      ["dynamic pric", "surge pric", "revenue manag", "yield", "fare class"],
  maintenance:          ["maintenance", "breakdown", "repair", "service due", "aog"],
  no_show:              ["no-show", "no show", "didn't show", "absent", "missed appointment"],
  inventory_tracking:   ["inventory", "stock", "out of stock", "track", "warehouse"],
  compliance:           ["complian", "regulation", "dgca", "easa", "hipaa", "dpdp", "audit"],
  integration:          ["integrat", "api", "connect", "sync", "export", "import"],
  onboarding:           ["onboard", "setup", "getting started", "new user", "first time"],
  reporting:            ["report", "analytics", "dashboard", "insights", "kpi", "metrics"],
  whatsapp:             ["whatsapp", "wa ", "message", "notification", "alert"],
  refund:               ["refund", "cancell", "money back", "compensation"],
  route_optimization:   ["route", "optimize", "delivery", "last mile", "dispatch"],
  capacity_management:  ["capacity", "occupancy", "utiliz", "fill rate", "seat", "room"],
};

// ── Detect signals from recent conversations ─────────────────────────────────
export async function detectProductSignals(): Promise<void> {
  try {
    const { db, advisorConversations, productSignals, userHealthScores } = await import("@workspace/db");
    const period   = isoWeek();
    const weekAgo  = new Date(Date.now() - 7 * 86400_000);

    // Get all user messages from the past week
    const recentMessages = await db
      .select({
        userId:   advisorConversations.userId,
        industry: advisorConversations.industry,
        content:  advisorConversations.content,
      })
      .from(advisorConversations)
      .where(
        and(
          eq(advisorConversations.role, "user"),
          gte(advisorConversations.createdAt, weekAgo)
        )
      )
      .limit(5000);

    // Count topic occurrences per industry
    type TopicKey = `${string}::${string}`;
    const topicCounts = new Map<TopicKey, { industry: string; topic: string; users: Set<string> }>();

    for (const msg of recentMessages) {
      const lower = msg.content.toLowerCase();
      for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
        if (keywords.some(k => lower.includes(k))) {
          const key: TopicKey = `${msg.industry}::${topic}`;
          if (!topicCounts.has(key)) {
            topicCounts.set(key, { industry: msg.industry, topic, users: new Set() });
          }
          topicCounts.get(key)!.users.add(msg.userId);
        }
      }
    }

    // Cross-industry totals
    const crossIndustry = new Map<string, { topic: string; users: Set<string>; industries: Set<string> }>();
    for (const [, data] of topicCounts) {
      if (!crossIndustry.has(data.topic)) {
        crossIndustry.set(data.topic, { topic: data.topic, users: new Set(), industries: new Set() });
      }
      const ci = crossIndustry.get(data.topic)!;
      data.users.forEach(u => ci.users.add(u));
      ci.industries.add(data.industry);
    }

    // Insert signals for counts >= 2 users
    for (const [key, data] of topicCounts) {
      if (data.users.size < 2) continue;

      const priority =
        data.users.size >= 10 ? "p0" :
        data.users.size >= 5  ? "high" :
        data.users.size >= 3  ? "medium" : "low";

      const description = `${data.users.size} ${data.industry} users asked about "${data.topic.replace(/_/g, " ")}" this week`;
      const sherlockInsight = data.users.size >= 5
        ? `Product signal: "${data.topic.replace(/_/g, " ")}" is a hot topic in ${data.industry} (${data.users.size} users). Consider a dedicated feature or improvement.`
        : null;

      await db
        .insert(productSignals)
        .values({
          industry:       data.industry,
          signalType:     "feature_request",
          topic:          data.topic,
          description,
          occurrenceCount: data.users.size,
          affectedUsers:  data.users.size,
          confidenceScore: Math.min(0.95, 0.3 + data.users.size * 0.1).toFixed(2),
          priority,
          sherlockInsight,
          sampleUserIds:  Array.from(data.users).slice(0, 5),
          period,
        })
        .onConflictDoNothing();
    }

    // Cross-industry signals (3+ industries same topic)
    for (const [, ci] of crossIndustry) {
      if (ci.industries.size < 3 || ci.users.size < 5) continue;

      const description = `Cross-industry signal: "${ci.topic.replace(/_/g, " ")}" mentioned by ${ci.users.size} users across ${ci.industries.size} industries`;
      const sherlockInsight = `PLATFORM-WIDE SIGNAL: "${ci.topic.replace(/_/g, " ")}" appears across ${Array.from(ci.industries).join(", ")}. This is a core platform gap — high ROI to address.`;

      await db
        .insert(productSignals)
        .values({
          industry:        null,
          signalType:      "feature_request",
          topic:           ci.topic,
          description,
          occurrenceCount: ci.users.size,
          affectedUsers:   ci.users.size,
          confidenceScore: "0.90",
          priority:        "p0",
          sherlockInsight,
          sampleUserIds:   Array.from(ci.users).slice(0, 5),
          relatedTopics:   Array.from(ci.industries),
          period,
        })
        .onConflictDoNothing();
    }

    // Churn risk cluster signal
    const [churnRow] = await db
      .select({ cnt: count(), industry: userHealthScores.industry })
      .from(userHealthScores)
      .where(sql`${userHealthScores.churnRisk} IN ('high','critical')`)
      .groupBy(userHealthScores.industry)
      .orderBy(sql`count(*) DESC`)
      .limit(1);

    if (churnRow && (churnRow.cnt ?? 0) >= 3) {
      await db.insert(productSignals).values({
        industry:        churnRow.industry,
        signalType:      "churn_risk_cluster",
        topic:           "churn_cluster",
        description:     `${churnRow.cnt} users in ${churnRow.industry} have high/critical churn risk this week`,
        occurrenceCount: churnRow.cnt ?? 0,
        affectedUsers:   churnRow.cnt ?? 0,
        confidenceScore: "0.85",
        priority:        "p0",
        sherlockInsight: `CHURN ALERT: ${churnRow.cnt} ${churnRow.industry} users at high/critical churn risk. Immediate outreach recommended.`,
        sampleUserIds:   [],
        period,
      }).onConflictDoNothing();
    }

    // ── Notify Founder on P0 signals ─────────────────────────────────────────
    const p0Count = [...topicCounts.values()].filter(d => d.users.size >= 10).length
                  + ([...crossIndustry.values()].filter(ci => ci.industries.size >= 3 && ci.users.size >= 5).length > 0 ? 1 : 0)
                  + (churnRow && (churnRow.cnt ?? 0) >= 3 ? 1 : 0);

    if (p0Count > 0) {
      const p0Lines: string[] = [];
      for (const [, data] of topicCounts) {
        if (data.users.size >= 10) {
          p0Lines.push(`• ${data.users.size} ${data.industry} users asking about "${data.topic.replace(/_/g, " ")}"`);
        }
      }
      if (churnRow && (churnRow.cnt ?? 0) >= 3) {
        p0Lines.push(`• ${churnRow.cnt} ${churnRow.industry} users at critical churn risk`);
      }
      for (const [, ci] of crossIndustry) {
        if (ci.industries.size >= 3 && ci.users.size >= 5) {
          p0Lines.push(`• Cross-industry signal: "${ci.topic.replace(/_/g, " ")}" across ${Array.from(ci.industries).join(", ")}`);
        }
      }

      notifyFounderP0(
        `${p0Count} P0 Signal${p0Count > 1 ? "s" : ""} Detected — ${period}`,
        `Sherlock detected ${p0Count} P0 product signal${p0Count > 1 ? "s" : ""} this week.\n\n${p0Lines.join("\n")}\n\nReview at: /api/signals/p0`,
        { period, p0Count }
      );
    }

    logger.info({ period }, "Product signals detected");
  } catch (e) {
    logger.warn({ err: e }, "detectProductSignals failed — non-fatal");
  }
}

// ── GET /api/signals — all signals, latest first (founder only) ───────────────
router.get("/", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, productSignals } = await import("@workspace/db");
  const onlyOpen  = req.query["open"] === "true";
  const industry  = req.query["industry"] as string | undefined;

  const conditions = [];
  if (onlyOpen)  conditions.push(eq(productSignals.isActedUpon, false));
  if (industry)  conditions.push(eq(productSignals.industry, industry));

  const rows = await db
    .select()
    .from(productSignals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productSignals.detectedAt))
    .limit(100);

  return res.json(ok({ total: rows.length, signals: rows }));
});

// ── GET /api/signals/p0 — only P0/high priority (founder only) ───────────────
router.get("/p0", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, productSignals } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(productSignals)
    .where(and(
      sql`${productSignals.priority} IN ('p0','high')`,
      eq(productSignals.isActedUpon, false),
    ))
    .orderBy(desc(productSignals.detectedAt));

  return res.json(ok({ total: rows.length, signals: rows }));
});

// ── POST /api/signals/detect — trigger detection manually (founder only) ──────
router.post("/detect", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  void detectProductSignals();
  return res.json(ok({ message: "Signal detection triggered (running async). Check /api/signals in 5-10 seconds." }));
});

// ── PATCH /api/signals/:id/act — mark signal as acted upon (founder only) ─────
router.patch("/:id/act", requireAuth, async (req, res) => {
  if (req.user!.sub !== FOUNDER_ID) return res.status(403).json(err("FORBIDDEN", "Founder only"));

  const { db, productSignals } = await import("@workspace/db");
  const id   = parseInt(String(req.params["id"] ?? "0"), 10);
  const note = (req.body as { note?: string }).note ?? null;

  await db.update(productSignals)
    .set({ isActedUpon: true, actedUponNote: note })
    .where(eq(productSignals.id, id));

  return res.json(ok({ message: "Signal marked as acted upon." }));
});

export { router as signalsRouter };
