// ─────────────────────────────────────────────────────────────────────────────
// Sherlock Intelligence Monitor — World-Class Edition
//
// TWO MODES:
//   1. Silent Watch (every 10 min) — full intelligence scan, email ONLY on anomaly
//   2. Deep Intelligence Report (every 48h) — GPT-5, Sherlock voice, full briefing
//
// INTELLIGENCE LAYERS:
//   • Business Intelligence   — subscriptions, growth, trial→paid conversion, churn
//   • Advisor Intelligence    — most/least active advisors, engagement trends
//   • Predictive Alerts       — linear regression on latency + memory trends
//   • Revenue Awareness       — £ impact on every anomaly (Basic=£25, Pro=£52, Premium=£108)
//   • Self-Correlation        — unified composite warnings, not scattered alerts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { notifyFounder } from "./notify-founder.js";
import { logger } from "./logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const WATCH_INTERVAL_MS   = 10 * 60 * 1000;       // 10 minutes
const REPORT_INTERVAL_MS  = 48 * 60 * 60 * 1000;  // 48 hours
const LATENCY_WARN_MS     = 400;
const LATENCY_CRIT_MS     = 800;
const MEM_WARN_MB         = 384;
const MEM_CRIT_MB         = 512;
const HISTORY_MAX         = 18;                    // ~3 hours of 10-min samples
const ALERT_COOLDOWN_MS   = 25 * 60 * 1000;       // 25 min between same-type alerts

const PLAN_VALUE: Record<string, number> = {
  trial: 0, basic: 25, pro: 52, premium: 108,
};

// ─── Self-Healing Actions ─────────────────────────────────────────────────────
async function attemptSelfHeal(snap: WatchSnapshot): Promise<string[]> {
  const actions: string[] = [];

  // 1. DB reconnect — if db is down, try a fresh query to force pool to reconnect
  if (!snap.dbOk) {
    try {
      await db.execute(sql`SELECT 1`);
      actions.push("DB pool reconnect: succeeded");
    } catch {
      actions.push("DB pool reconnect: still unreachable");
    }
  }

  // 2. Memory pressure — if heap is critical, nudge V8 GC (Node --expose-gc flag needed, fail silently)
  if (snap.memUsedMb > MEM_CRIT_MB) {
    try {
      const gc = (global as Record<string, unknown>)["gc"];
      if (typeof gc === "function") { (gc as () => void)(); actions.push(`GC triggered — heap was ${snap.memUsedMb}MB`); }
      else actions.push("GC unavailable (no --expose-gc flag) — memory remains elevated");
    } catch { /* silent */ }
  }

  // 3. API not responding — log clearly; Tiger cannot restart Replit workflows programmatically
  if (!snap.apiOk) {
    actions.push("API DOWN — cannot self-restart (Replit managed). Founder + Tiger manual restart required.");
  }

  if (actions.length > 0) logger.warn({ actions }, "Sherlock: self-heal attempted");
  return actions;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface WatchSnapshot {
  ts:              number;
  // Infrastructure
  dbOk:            boolean;
  dbLatencyMs:     number;
  apiOk:           boolean;
  uptimeSeconds:   number;
  memUsedMb:       number;
  // Platform
  conversations:   number;
  memories:        number;
  activeIssues:    number;
  inboundEmails:   number;
  whatsappUsers:   number;
  // Business
  totalSubs:       number;
  activeSubs:      number;
  trialSubs:       number;
  basicSubs:       number;
  proSubs:         number;
  premiumSubs:     number;
  cancelPending:   number;
  // Intelligence
  signalsP0:       number;
  criticalChurn:   number;
  revenueAtRisk:   number;
  // Advisors
  advisorActivity: Record<string, number>;
}

interface Anomaly {
  severity: "P0" | "P1" | "P2";
  title:    string;
  detail:   string;
  revenueImpact?: string;
}

// ─── Rolling history ──────────────────────────────────────────────────────────
const history: WatchSnapshot[] = [];
let lastAlertTs       = 0;
let consecutiveErrors = 0;

// ─── Linear Regression (for predictive alerts) ────────────────────────────────
function linearRegression(values: number[]): { slope: number; predictAt: (steps: number) => number } {
  const n = values.length;
  if (n < 2) return { slope: 0, predictAt: () => values[values.length - 1] ?? 0 };
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((acc, v, i) => acc + i * v, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return {
    slope,
    predictAt: (steps: number) => intercept + slope * (n - 1 + steps),
  };
}

// ─── Data Collection ──────────────────────────────────────────────────────────
async function collectSnapshot(): Promise<WatchSnapshot> {
  const ts            = Date.now();
  const uptimeSeconds = Math.floor(process.uptime());
  const memUsedMb     = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  let dbOk = false, dbLatencyMs = 0;
  let conversations = 0, memories = 0, activeIssues = 0;
  let inboundEmails = 0, whatsappUsers = 0;
  let totalSubs = 0, activeSubs = 0, trialSubs = 0, basicSubs = 0, proSubs = 0, premiumSubs = 0, cancelPending = 0;
  let signalsP0 = 0, criticalChurn = 0;
  let revenueAtRisk = 0;
  let advisorActivity: Record<string, number> = {};

  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t0;
    dbOk = true;

    const results = await Promise.allSettled([
      // [0] conversations
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM advisor_conversations`),
      // [1] memories
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM advisor_memory_vault`),
      // [2] active issues
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM ai_resolution_issues WHERE status != 'resolved'`),
      // [3] inbound emails
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM inbound_emails`),
      // [4] whatsapp active
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM whatsapp_users WHERE status = 'active'`),
      // [5] subscription breakdown
      db.execute(sql`
        SELECT
          COUNT(*)::int                                             AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int           AS active,
          COUNT(*) FILTER (WHERE plan = 'trial')::int              AS trial,
          COUNT(*) FILTER (WHERE plan = 'basic')::int              AS basic,
          COUNT(*) FILTER (WHERE plan = 'pro')::int                AS pro,
          COUNT(*) FILTER (WHERE plan = 'premium')::int            AS premium,
          COUNT(*) FILTER (WHERE cancel_at_period_end = true)::int AS cancel_pending
        FROM subscriptions
      `),
      // [6] P0 signals
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM product_signals WHERE priority = 'p0' AND status = 'open'`),
      // [7] critical churn users
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM user_health_scores WHERE churn_risk = 'critical'`),
      // [8] total revenue at risk
      db.execute(sql`SELECT COALESCE(SUM(revenue_at_risk), 0)::float AS total FROM user_health_scores WHERE churn_risk IN ('high', 'critical')`),
      // [9] advisor activity (last 24h)
      db.execute(sql`
        SELECT advisor, COUNT(*)::int AS cnt
        FROM advisor_conversations
        WHERE role = 'user' AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY advisor
        ORDER BY cnt DESC
      `),
    ]);

    const safeInt = (r: PromiseSettledResult<unknown>, field: string): number => {
      if (r.status !== "fulfilled") return 0;
      const row = (r.value as unknown as Array<Record<string, unknown>>)[0];
      return Number(row?.[field] ?? 0);
    };

    conversations = safeInt(results[0]!, "cnt");
    memories      = safeInt(results[1]!, "cnt");
    activeIssues  = safeInt(results[2]!, "cnt");
    inboundEmails = safeInt(results[3]!, "cnt");
    whatsappUsers = safeInt(results[4]!, "cnt");
    signalsP0     = safeInt(results[6]!, "cnt");
    criticalChurn = safeInt(results[7]!, "cnt");
    revenueAtRisk = safeInt(results[8]!, "total");

    if (results[5]!.status === "fulfilled") {
      const row = (results[5]!.value as unknown as Array<Record<string, number>>)[0];
      if (row) {
        totalSubs     = row["total"]         ?? 0;
        activeSubs    = row["active"]        ?? 0;
        trialSubs     = row["trial"]         ?? 0;
        basicSubs     = row["basic"]         ?? 0;
        proSubs       = row["pro"]           ?? 0;
        premiumSubs   = row["premium"]       ?? 0;
        cancelPending = row["cancel_pending"] ?? 0;
      }
    }

    if (results[9]!.status === "fulfilled") {
      const rows = results[9]!.value as unknown as Array<{ advisor: string; cnt: number }>;
      for (const r of rows) advisorActivity[r.advisor] = r.cnt;
    }
  } catch (e) {
    logger.warn({ err: e }, "Sherlock: collection failed");
  }

  // API self-ping
  let apiOk = false;
  try {
    const port = process.env["PORT"] ?? "8080";
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(4_000) });
    apiOk = r.ok;
  } catch { apiOk = false; }

  return {
    ts, dbOk, dbLatencyMs, apiOk, uptimeSeconds, memUsedMb,
    conversations, memories, activeIssues, inboundEmails, whatsappUsers,
    totalSubs, activeSubs, trialSubs, basicSubs, proSubs, premiumSubs, cancelPending,
    signalsP0, criticalChurn, revenueAtRisk, advisorActivity,
  };
}

// ─── MRR Calculation ──────────────────────────────────────────────────────────
function calcMRR(snap: WatchSnapshot): number {
  return (snap.basicSubs * PLAN_VALUE["basic"]!) +
         (snap.proSubs   * PLAN_VALUE["pro"]!)   +
         (snap.premiumSubs * PLAN_VALUE["premium"]!);
}

// ─── Anomaly Detection (with self-correlation + predictive) ───────────────────
function detectAnomalies(snap: WatchSnapshot): Anomaly[] {
  const raw: Anomaly[] = [];
  const prev = history[history.length - 1];

  // ── Infrastructure ──
  if (!snap.dbOk)  raw.push({ severity: "P0", title: "Database DOWN", detail: "PostgreSQL unreachable. All AI advisors and data operations blocked." });
  if (!snap.apiOk) raw.push({ severity: "P0", title: "API Server not responding", detail: "Health endpoint failed. User requests may be failing platform-wide." });

  // ── Predictive: latency trend ──
  if (snap.dbOk && history.length >= 4) {
    const latencies = history.slice(-6).map(h => h.dbLatencyMs);
    const { slope, predictAt } = linearRegression(latencies);
    const predicted30min = predictAt(3); // 3 more 10-min steps = 30 min
    if (slope > 20 && predicted30min > LATENCY_CRIT_MS) {
      raw.push({
        severity: "P1",
        title: `DB Latency trending up — predicted ${Math.round(predicted30min)}ms in 30 min`,
        detail: `Current: ${snap.dbLatencyMs}ms. Rising at +${Math.round(slope)}ms/sample. Will breach ${LATENCY_CRIT_MS}ms threshold within ~30 minutes at this rate.`,
      });
    } else if (snap.dbLatencyMs > LATENCY_CRIT_MS) {
      raw.push({ severity: "P1", title: `DB Latency spike: ${snap.dbLatencyMs}ms`, detail: `Normal <100ms. Advisors and data endpoints may feel slow to users.` });
    }
  } else if (snap.dbOk && snap.dbLatencyMs > LATENCY_CRIT_MS) {
    raw.push({ severity: "P1", title: `DB Latency: ${snap.dbLatencyMs}ms`, detail: "Database responding slowly." });
  }

  // ── Predictive: memory trend ──
  if (history.length >= 4) {
    const mems = history.slice(-6).map(h => h.memUsedMb);
    const { slope: memSlope, predictAt: memPredict } = linearRegression(mems);
    const predicted60min = memPredict(6);
    if (memSlope > 8 && predicted60min > MEM_CRIT_MB) {
      raw.push({
        severity: "P1",
        title: `Memory leak risk — predicted ${Math.round(predicted60min)}MB in 60 min`,
        detail: `Heap growing at +${Math.round(memSlope)}MB/sample. Will breach ${MEM_CRIT_MB}MB in ~60 min. Server restart may be needed.`,
      });
    } else if (snap.memUsedMb > MEM_CRIT_MB) {
      raw.push({ severity: "P1", title: `Memory critical: ${snap.memUsedMb}MB`, detail: `Heap at ${snap.memUsedMb}MB — above safe threshold.` });
    }
  }

  // ── Business Intelligence ──
  if (prev) {
    const subDrop = prev.activeSubs - snap.activeSubs;
    if (subDrop > 0) {
      const lostMRR = subDrop * 25; // conservative estimate
      raw.push({
        severity: "P1",
        title: `Active subscriptions dropped by ${subDrop}`,
        detail: `Was ${prev.activeSubs}, now ${snap.activeSubs}.`,
        revenueImpact: `~£${lostMRR}/mo MRR at risk`,
      });
    }
    const newCancels = snap.cancelPending - prev.cancelPending;
    if (newCancels > 0) {
      raw.push({
        severity: "P1",
        title: `${newCancels} new cancellation(s) flagged`,
        detail: `Users set cancel_at_period_end=true. They will churn at period end unless recovered.`,
        revenueImpact: `£${newCancels * 25}–£${newCancels * 108}/mo at risk`,
      });
    }
  }

  // ── Churn intelligence ──
  if (snap.criticalChurn > 0) {
    raw.push({
      severity: "P1",
      title: `${snap.criticalChurn} user(s) at CRITICAL churn risk`,
      detail: `Health Score engine flagged critical churn. Immediate advisor outreach recommended.`,
      revenueImpact: snap.revenueAtRisk > 0 ? `£${snap.revenueAtRisk.toFixed(0)} total revenue at risk` : undefined,
    });
  }

  // ── Issues surge ──
  if (prev && snap.activeIssues > prev.activeIssues + 2) {
    raw.push({
      severity: "P1",
      title: `${snap.activeIssues - prev.activeIssues} new unresolved issues (10 min)`,
      detail: `Open issues: ${prev.activeIssues} → ${snap.activeIssues}. AI Resolution Hub needs attention.`,
    });
  }

  // ── P0 product signals ──
  if (snap.signalsP0 > 0) {
    raw.push({
      severity: "P1",
      title: `${snap.signalsP0} open P0 product signal(s)`,
      detail: "Cross-industry pattern engine flagged top-priority product opportunities. Review signals dashboard.",
    });
  }

  // ── Self-Correlation: Composite capacity warning ──
  const infraStressed    = snap.memUsedMb > MEM_WARN_MB && snap.dbLatencyMs > LATENCY_WARN_MS;
  const convSurge        = prev && (snap.conversations - prev.conversations) > 50;
  if (infraStressed && convSurge) {
    raw.push({
      severity: "P1",
      title: "Composite Capacity Warning",
      detail: `High memory (${snap.memUsedMb}MB) + DB latency (${snap.dbLatencyMs}ms) + conversation surge detected simultaneously. System is under load. Monitor closely — may need restart.`,
    });
  }

  // ── Deduplicate: remove individual alerts if composite covers them ──
  const hasComposite = raw.some(a => a.title === "Composite Capacity Warning");
  return raw.filter(a =>
    hasComposite
      ? !a.title.startsWith("DB Latency") && !a.title.startsWith("Memory")
      : true
  );
}

// ─── HTML: Alert Email ────────────────────────────────────────────────────────
function buildAlertHtml(snap: WatchSnapshot, anomalies: Anomaly[]): string {
  const top    = anomalies.some(a => a.severity === "P0") ? "P0" : anomalies.some(a => a.severity === "P1") ? "P1" : "P2";
  const hColor = top === "P0" ? "#dc2626" : top === "P1" ? "#ea580c" : "#ca8a04";
  const hLabel = top === "P0" ? "🔴 CRITICAL" : top === "P1" ? "🟠 WARNING" : "🟡 ADVISORY";
  const mrr    = calcMRR(snap);

  const rows = anomalies.map(a => {
    const c = a.severity === "P0" ? "#dc2626" : a.severity === "P1" ? "#ea580c" : "#ca8a04";
    return `
    <div style="border-left:3px solid ${c};padding:12px 16px;margin:10px 0;background:rgba(255,255,255,0.03);border-radius:0 8px 8px 0;">
      <div style="font-size:13px;font-weight:600;color:${c}">[${a.severity}] ${a.title}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;line-height:1.5">${a.detail}</div>
      ${a.revenueImpact ? `<div style="margin-top:6px;font-size:11px;color:#f59e0b;font-weight:600">💰 ${a.revenueImpact}</div>` : ""}
    </div>`;
  }).join("");

  return `
  <div style="font-family:'Segoe UI',sans-serif;max-width:660px;margin:0 auto;background:#06090f;color:#e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:${hColor};padding:22px 32px;">
      <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:6px">Sherlock Intelligence Alert</div>
      <div style="font-size:18px;font-weight:700;color:#fff">${hLabel} — ${anomalies.length} issue(s) detected</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:6px">${new Date(snap.ts).toUTCString()}</div>
    </div>
    <div style="padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:14px">Detected Issues</div>
      ${rows}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid rgba(255,255,255,0.06);">
      ${[
        { label: "MRR", value: `£${mrr}` },
        { label: "Active Subs", value: snap.activeSubs },
        { label: "Cancellations", value: snap.cancelPending, warn: snap.cancelPending > 0 },
        { label: "Churn Risk", value: snap.criticalChurn + " critical", warn: snap.criticalChurn > 0 },
      ].map((k, i) => `
      <div style="padding:14px 16px;${i < 3 ? "border-right:1px solid rgba(255,255,255,0.06);" : ""}">
        <div style="font-size:16px;font-weight:700;color:${(k as { warn?: boolean }).warn ? "#ef4444" : "#00e5ff"}">${k.value}</div>
        <div style="font-size:10px;color:#475569;margin-top:2px">${k.label}</div>
      </div>`).join("")}
    </div>
    <div style="padding:18px 32px;background:rgba(0,0,0,0.3);">
      <p style="margin:0;font-size:11px;color:#475569">
        <strong style="color:#00e5ff">Sherlock</strong> — silent watch detected this automatically. Next check in 10 min.
      </p>
    </div>
  </div>`;
}

// ─── HTML: 48-Hour Deep Report ────────────────────────────────────────────────
interface ChurnTargetRow { user_id: string; industry: string; score: number; revenue_at_risk: number; advisor_action: string | null; }

function buildDeepReportHtml(snap: WatchSnapshot, reportText: string, extra: {
  recentConvs: number; resolvedIssues: number; memGrowth: number;
  convGrowth: number; topAdvisor: string; dormantAdvisors: string[];
  trialConvRate: number;
  wowSubsGrowth: number; lastWeekSubs: number;
  wowConvGrowth: number; lastWeekConvs: number;
  churnTargets: ChurnTargetRow[];
}): string {
  const mrr = calcMRR(snap);
  const arr = mrr * 12;

  const advisorRows = Object.entries(snap.advisorActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([adv, cnt]) => `
    <tr>
      <td style="padding:5px 0;color:#94a3b8;font-size:12px">${adv}</td>
      <td style="padding:5px 0;text-align:right;font-family:monospace;font-size:12px;color:${cnt > 0 ? "#00e5ff" : "#475569"}">${cnt > 0 ? `${cnt} msgs` : "dormant"}</td>
    </tr>`).join("");

  const formatted = reportText
    .replace(/^(ACTION \d:?.+)$/gm, `<div style="margin:14px 0 6px"><span style="background:#00e5ff;color:#06090f;font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:1px">$1</span></div>`)
    .replace(/\n\n/g, `</p><p style="color:#cbd5e1;line-height:1.75;margin:10px 0">`)
    .replace(/\n/g, "<br>");

  return `
  <div style="font-family:'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#06090f;color:#e2e8f0;border-radius:12px;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 36px;border-bottom:2px solid rgba(0,229,255,0.25);">
      <div style="font-size:10px;letter-spacing:4px;color:#00e5ff;text-transform:uppercase;margin-bottom:8px">Sherlock · 48-Hour Intelligence Report</div>
      <div style="font-size:26px;font-weight:700;color:#f8fafc">HostFlow AI — Founder Briefing</div>
      <div style="font-size:12px;color:#475569;margin-top:8px">${new Date(snap.ts).toUTCString()}</div>
    </div>

    <!-- KPI strip -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid rgba(255,255,255,0.06);">
      ${[
        { label: "MRR", value: `£${mrr}`, sub: `ARR £${arr}` },
        { label: "Active Subs", value: snap.activeSubs, sub: `${snap.trialSubs} trials` },
        { label: "Conversations (48h)", value: extra.recentConvs, sub: `+${extra.convGrowth} growth` },
        { label: "Churn Risk", value: `${snap.criticalChurn} critical`, sub: `£${snap.revenueAtRisk.toFixed(0)} at risk`, warn: snap.criticalChurn > 0 },
      ].map((k, i) => `
      <div style="padding:18px 20px;${i < 3 ? "border-right:1px solid rgba(255,255,255,0.06);" : ""}">
        <div style="font-size:20px;font-weight:700;color:${(k as { warn?: boolean }).warn ? "#ef4444" : "#00e5ff"}">${k.value}</div>
        <div style="font-size:10px;color:#475569;margin-top:2px;text-transform:uppercase;letter-spacing:1px">${k.label}</div>
        <div style="font-size:11px;color:#334155;margin-top:3px">${k.sub}</div>
      </div>`).join("")}
    </div>

    <!-- Business breakdown -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="padding:22px 28px;border-right:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:14px">Subscription Mix</div>
        <table style="width:100%;border-collapse:collapse;">
          ${[
            ["Trial", snap.trialSubs, "£0"],
            ["Basic", snap.basicSubs, `£${snap.basicSubs * 25}/mo`],
            ["Pro", snap.proSubs, `£${snap.proSubs * 52}/mo`],
            ["Premium", snap.premiumSubs, `£${snap.premiumSubs * 108}/mo`],
            ["Cancellations", snap.cancelPending, "at risk"],
          ].map(([label, count, rev]) => `
          <tr>
            <td style="padding:5px 0;color:#94a3b8;font-size:12px">${label}</td>
            <td style="padding:5px 0;text-align:center;font-family:monospace;font-size:12px;color:#e2e8f0">${count}</td>
            <td style="padding:5px 0;text-align:right;font-size:11px;color:#475569">${rev}</td>
          </tr>`).join("")}
        </table>
        <div style="margin-top:14px;padding:10px 14px;background:rgba(0,229,255,0.06);border-radius:6px;border:1px solid rgba(0,229,255,0.15);">
          <div style="font-size:11px;color:#64748b">Trial → Paid Conversion</div>
          <div style="font-size:18px;font-weight:700;color:#00e5ff;margin-top:2px">${extra.trialConvRate.toFixed(1)}%</div>
        </div>
      </div>
      <div style="padding:22px 28px;">
        <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:14px">Advisor Activity (24h)</div>
        <table style="width:100%;border-collapse:collapse;">${advisorRows || "<tr><td style='color:#475569;font-size:12px'>No activity data</td></tr>"}</table>
        ${extra.dormantAdvisors.length > 0 ? `
        <div style="margin-top:12px;padding:8px 12px;background:rgba(239,68,68,0.08);border-radius:6px;border:1px solid rgba(239,68,68,0.2);">
          <div style="font-size:10px;color:#ef4444">DORMANT ADVISORS</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${extra.dormantAdvisors.join(", ")}</div>
        </div>` : ""}
      </div>
    </div>

    <!-- AI Intelligence body -->
    <div style="padding:30px 36px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:18px">Sherlock Intelligence Analysis</div>
      <p style="color:#cbd5e1;line-height:1.75;margin:0">${formatted}</p>
    </div>

    <!-- Week-over-week + Churn outreach -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="padding:22px 28px;border-right:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:14px">Week-over-Week</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr>
            <td style="padding:5px 0;color:#64748b">Subscriptions</td>
            <td style="text-align:right;font-family:monospace;color:${extra.wowSubsGrowth >= 0 ? "#22c55e" : "#ef4444"}">${extra.wowSubsGrowth >= 0 ? "+" : ""}${extra.wowSubsGrowth} vs last week (${extra.lastWeekSubs})</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#64748b">Conversations</td>
            <td style="text-align:right;font-family:monospace;color:${extra.wowConvGrowth >= 0 ? "#22c55e" : "#ef4444"}">${extra.wowConvGrowth >= 0 ? "+" : ""}${extra.wowConvGrowth} vs last week (${extra.lastWeekConvs})</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#64748b">MRR trend</td>
            <td style="text-align:right;font-family:monospace;color:#e2e8f0">£${calcMRR(snap)}/mo</td>
          </tr>
        </table>
      </div>
      <div style="padding:22px 28px;">
        <div style="font-size:10px;letter-spacing:2px;color:#ef4444;text-transform:uppercase;margin-bottom:14px">Outreach Targets — High/Critical Churn</div>
        ${extra.churnTargets.length === 0
          ? `<div style="font-size:12px;color:#22c55e">No high-risk users. All clear.</div>`
          : `<table style="width:100%;border-collapse:collapse;font-size:11px;">
              <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
                <th style="padding:4px 0;color:#64748b;text-align:left;font-weight:normal">Industry</th>
                <th style="padding:4px 0;color:#64748b;text-align:center;font-weight:normal">Score</th>
                <th style="padding:4px 0;color:#64748b;text-align:right;font-weight:normal">At Risk</th>
              </tr>
              ${extra.churnTargets.map(t => `
              <tr>
                <td style="padding:5px 0;color:#94a3b8">${t.industry}</td>
                <td style="padding:5px 0;text-align:center;font-family:monospace;color:${t.score < 30 ? "#ef4444" : "#f59e0b"}">${t.score}</td>
                <td style="padding:5px 0;text-align:right;color:#f59e0b">£${Number(t.revenue_at_risk).toFixed(0)}</td>
              </tr>
              ${t.advisor_action ? `<tr><td colspan="3" style="padding:0 0 6px 0;font-size:10px;color:#475569;font-style:italic">${t.advisor_action}</td></tr>` : ""}`).join("")}
            </table>`
        }
      </div>
    </div>

    <!-- System health -->
    <div style="padding:22px 36px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;letter-spacing:2px;color:#00e5ff;text-transform:uppercase;margin-bottom:14px">System Health</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr><td style="padding:5px 0;color:#64748b">Database</td><td style="text-align:right;font-family:monospace;color:${snap.dbOk ? "#22c55e" : "#ef4444"}">${snap.dbOk ? `Connected · ${snap.dbLatencyMs}ms` : "DOWN"}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">API Server</td><td style="text-align:right;font-family:monospace;color:${snap.apiOk ? "#22c55e" : "#ef4444"}">${snap.apiOk ? "Operational" : "DOWN"}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Memory (heap)</td><td style="text-align:right;font-family:monospace;color:#e2e8f0">${snap.memUsedMb} MB</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Uptime</td><td style="text-align:right;font-family:monospace;color:#e2e8f0">${Math.floor(snap.uptimeSeconds / 3600)}h ${Math.floor((snap.uptimeSeconds % 3600) / 60)}m</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Memory vault</td><td style="text-align:right;font-family:monospace;color:#e2e8f0">${snap.memories.toLocaleString()} entries (+${extra.memGrowth} this period)</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">P0 Signals</td><td style="text-align:right;font-family:monospace;color:${snap.signalsP0 > 0 ? "#ef4444" : "#22c55e"}">${snap.signalsP0}</td></tr>
      </table>
    </div>

    <div style="padding:18px 36px;background:rgba(0,0,0,0.4);">
      <p style="margin:0;font-size:11px;color:#334155;line-height:1.6">
        <strong style="color:#00e5ff">Sherlock</strong> · Chief Intelligence Officer · HostFlow AI<br>
        Silent watch every 10 minutes · Next full report in 48 hours<br>
        <a href="https://hostflowai-brain--naumansherwani.replit.app" style="color:#00e5ff;text-decoration:none">hostflowai-brain--naumansherwani.replit.app</a>
      </p>
    </div>
  </div>`;
}

// ─── 48-Hour Deep Report Generation ──────────────────────────────────────────
async function generateDeepReport(snap: WatchSnapshot): Promise<void> {
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const mrr     = calcMRR(snap);

  // Extra intelligence
  let recentConvs = 0, resolvedIssues = 0, memGrowth = 0, convGrowth = 0, trialConvRate = 0;
  const dormantAdvisors: string[] = [];
  const allAdvisors = ["Aria","Captain Orion","Rex","Dr. Lyra","Professor Sage","Atlas","Vega","Conductor Kai","Sherlock"];

  // Week-over-week
  let wowSubsGrowth = 0, wowConvGrowth = 0, lastWeekSubs = 0, lastWeekConvs = 0;

  // User-level outreach targets
  interface ChurnTarget { user_id: string; industry: string; score: number; revenue_at_risk: number; advisor_action: string | null; }
  let churnTargets: ChurnTarget[] = [];

  try {
    const [recentRow, resolvedRow, prevConvRow, wowSubsRow, wowConvRow, churnRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM advisor_conversations WHERE created_at > NOW() - INTERVAL '48 hours'`),
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM ai_resolution_issues WHERE status = 'resolved' AND updated_at > NOW() - INTERVAL '48 hours'`),
      db.execute(sql`SELECT COUNT(*)::int AS cnt FROM advisor_conversations WHERE created_at BETWEEN NOW() - INTERVAL '96 hours' AND NOW() - INTERVAL '48 hours'`),
      // WoW: subscriptions 7 days ago vs today
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM subscriptions
        WHERE status = 'active' AND created_at < NOW() - INTERVAL '7 days'
      `),
      // WoW: conversations last week vs this week
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM advisor_conversations
        WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
      `),
      // User-level churn targets: top 5 highest-risk users
      db.execute(sql`
        SELECT
          uhs.user_id,
          COALESCE(up.industry, 'unknown')   AS industry,
          uhs.score,
          COALESCE(uhs.revenue_at_risk, 0)   AS revenue_at_risk,
          uhs.advisor_action
        FROM user_health_scores uhs
        LEFT JOIN user_profiles up ON up.user_id = uhs.user_id
        WHERE uhs.churn_risk IN ('high', 'critical')
        ORDER BY uhs.revenue_at_risk DESC NULLS LAST, uhs.score ASC
        LIMIT 5
      `),
    ]);

    recentConvs   = (recentRow  as unknown as [{cnt:number}])[0]?.cnt ?? 0;
    resolvedIssues= (resolvedRow as unknown as [{cnt:number}])[0]?.cnt ?? 0;
    const prevConvs= (prevConvRow as unknown as [{cnt:number}])[0]?.cnt ?? 0;
    convGrowth    = recentConvs - prevConvs;

    lastWeekSubs  = (wowSubsRow  as unknown as [{cnt:number}])[0]?.cnt ?? 0;
    lastWeekConvs = (wowConvRow  as unknown as [{cnt:number}])[0]?.cnt ?? 0;
    wowSubsGrowth = snap.activeSubs - lastWeekSubs;
    wowConvGrowth = recentConvs - lastWeekConvs;

    churnTargets  = (churnRows as unknown as ChurnTarget[]).map(r => ({
      user_id:        String(r.user_id).slice(0, 8) + "…",  // partial ID for privacy
      industry:       r.industry,
      score:          Number(r.score),
      revenue_at_risk: Number(r.revenue_at_risk),
      advisor_action: r.advisor_action ?? null,
    }));

    if (history.length >= 2) memGrowth = snap.memories - (history[0]?.memories ?? snap.memories);
    trialConvRate = snap.totalSubs > 0 ? ((snap.totalSubs - snap.trialSubs) / snap.totalSubs) * 100 : 0;
    for (const a of allAdvisors) if (!snap.advisorActivity[a]) dormantAdvisors.push(a);
  } catch (e) {
    logger.warn({ err: e }, "Sherlock: deep report extra data failed");
  }

  const topAdvisor = Object.entries(snap.advisorActivity).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "N/A";

  if (!baseUrl || !apiKey) {
    await notifyFounder({
      subject: `Sherlock 48h Report — ${new Date().toLocaleDateString("en-GB")}`,
      body: `MRR: £${mrr} | Active: ${snap.activeSubs} | Conversations (48h): ${recentConvs} | Issues: ${snap.activeIssues} | DB: ${snap.dbOk?"OK":"DOWN"}`,
      priority: "info",
    });
    return;
  }

  const prompt = `You are Sherlock — Chief Intelligence Officer for HostFlow AI. Founder: Muhammad Nauman Sherwani.

Write his 48-hour intelligence briefing. Direct. Precise. No pleasantries. Reference the actual numbers below. Diagnose what they mean. Call out week-over-week trends explicitly. If churn targets exist, name the industries at risk. End with exactly 3 next actions for Tiger (the Replit AI builder).

DATA:
MRR: £${mrr}/mo | ARR: £${mrr*12}/yr
Subscriptions — Total: ${snap.totalSubs} | Active: ${snap.activeSubs} | Trial: ${snap.trialSubs} | Basic: ${snap.basicSubs} | Pro: ${snap.proSubs} | Premium: ${snap.premiumSubs} | Cancellations pending: ${snap.cancelPending}
Week-over-week subs: ${wowSubsGrowth >= 0 ? "+" : ""}${wowSubsGrowth} (was ${lastWeekSubs} last week)
Trial→Paid conversion: ${trialConvRate.toFixed(1)}%
Conversations (last 48h): ${recentConvs} | vs prior 48h: ${recentConvs - convGrowth} | 48h growth: ${convGrowth > 0 ? "+" : ""}${convGrowth}
Week-over-week conversations: ${wowConvGrowth >= 0 ? "+" : ""}${wowConvGrowth} (last week: ${lastWeekConvs})
Memory vault: ${snap.memories.toLocaleString()} entries | growth this period: +${memGrowth}
Active WhatsApp users: ${snap.whatsappUsers}
Inbound emails: ${snap.inboundEmails}
Most active advisor (24h): ${topAdvisor}
Dormant advisors (24h): ${dormantAdvisors.length > 0 ? dormantAdvisors.join(", ") : "none"}
Open unresolved issues: ${snap.activeIssues} | Resolved (48h): ${resolvedIssues}
Critical churn users: ${snap.criticalChurn} | Revenue at risk: £${snap.revenueAtRisk.toFixed(0)}
Churn target industries: ${churnTargets.map(t => t.industry).join(", ") || "none"}
P0 product signals: ${snap.signalsP0}
System: DB ${snap.dbOk?"OK ("+snap.dbLatencyMs+"ms)":"DOWN"} | API ${snap.apiOk?"OK":"DOWN"} | Memory ${snap.memUsedMb}MB | Uptime ${Math.floor(snap.uptimeSeconds/3600)}h`;

  try {
    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ baseURL: baseUrl, apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });
    const reportText = completion.choices[0]?.message?.content ?? "Report generation failed.";

    await notifyFounder({
      subject:  `Sherlock 48h Report — ${new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })} | MRR £${mrr}`,
      body:     reportText,
      priority: "info",
      htmlBody: buildDeepReportHtml(snap, reportText, { recentConvs, resolvedIssues, memGrowth, convGrowth, topAdvisor, dormantAdvisors, trialConvRate, wowSubsGrowth, lastWeekSubs, wowConvGrowth, lastWeekConvs, churnTargets }),
    });
    logger.info("Sherlock: 48h deep report sent");
  } catch (e) {
    logger.error({ err: e }, "Sherlock: deep report GPT failed");
  }
}

// ─── 10-Minute Silent Watch ───────────────────────────────────────────────────
async function runSilentWatch(): Promise<void> {
  try {
    const snap = await collectSnapshot();
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();

    const anomalies = detectAnomalies(snap);
    const allClear  = snap.dbOk && snap.apiOk && anomalies.length === 0;

    logger.info({
      db_ok: snap.dbOk, db_ms: snap.dbLatencyMs, api_ok: snap.apiOk,
      mem_mb: snap.memUsedMb, subs: snap.activeSubs, mrr: calcMRR(snap),
      convs: snap.conversations, issues: snap.activeIssues, anomalies: anomalies.length,
    }, "Sherlock silent watch");

    if (!allClear) {
      consecutiveErrors++;

      // Self-heal attempt (fire-and-forget — runs regardless of alert cooldown)
      attemptSelfHeal(snap).catch(() => {});

      const cooldown = consecutiveErrors >= 3 ? 0 : ALERT_COOLDOWN_MS;
      if (Date.now() - lastAlertTs > cooldown) {
        lastAlertTs = Date.now();
        const top = anomalies.some(a => a.severity === "P0") ? "P0" : anomalies.some(a => a.severity === "P1") ? "P1" : "P2";
        await notifyFounder({
          subject:  `Sherlock [${top}] — ${anomalies[0]?.title ?? "Anomaly detected"} | MRR £${calcMRR(snap)}`,
          body:     anomalies.map(a => `[${a.severity}] ${a.title}\n${a.detail}${a.revenueImpact ? "\n💰 " + a.revenueImpact : ""}`).join("\n\n"),
          priority: top === "P0" ? "P0" : top === "P1" ? "P1" : "P2",
          htmlBody: buildAlertHtml(snap, anomalies),
        });
      }
    } else {
      consecutiveErrors = 0;
    }
  } catch (e) {
    logger.error({ err: e }, "Sherlock silent watch crashed");
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
export function startSherlockMonitor(): void {
  logger.info({ watch_ms: WATCH_INTERVAL_MS, report_ms: REPORT_INTERVAL_MS }, "Sherlock Intelligence Monitor started");

  // Silent watch: warm-up 2 min then every 10 min
  setTimeout(() => {
    runSilentWatch().catch(() => {});
    setInterval(() => runSilentWatch().catch(() => {}), WATCH_INTERVAL_MS);
  }, 2 * 60 * 1000);

  // Deep report: every 48 hours
  setInterval(async () => {
    const snap = history[history.length - 1] ?? await collectSnapshot().catch(() => null);
    if (snap) await generateDeepReport(snap).catch(e => logger.error({ err: e }, "Sherlock deep report failed"));
  }, REPORT_INTERVAL_MS);
}
