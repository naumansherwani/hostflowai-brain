import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { checkAiLimit } from "../middleware/check-ai-limit.js";
import { requireIndustryMatch } from "../middleware/require-industry-match.js";
import { requireSurface } from "../middleware/require-surface.js";
import { err, ok } from "../lib/response.js";
import {
  buildIndustrySystemPrompt,
  VALID_INDUSTRIES,
  normalizeIndustrySlug,
  type UserContext,
} from "../lib/industry-advisor-prompts.js";
import {
  getAdvisor,
  getAllAdvisors,
  OWNER_ADVISOR,
  ESCALATION_CHAIN,
} from "../lib/advisor-voice-config.js";
import { eventBus } from "../lib/event-bus.js";

const router: IRouter = Router();

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  TIGER LOCKED — DO NOT CHANGE ADVISOR NAMES (FOUNDER APPROVED)             ║
// ║  Source of truth: industry-advisor-prompts.ts → ADVISOR_NAMES              ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
const ADVISOR_NAME_BY_INDUSTRY: Record<string, string> = {
  hospitality:          "Aria",
  airlines:             "Captain Orion",
  car_rental:           "Rex",
  healthcare:           "Dr. Lyra",
  education:            "Professor Sage",
  logistics:            "Atlas",
  events_entertainment: "Vega",
  railways:             "Conductor Kai",
};

const NORMAL_SLA_MS   = 120_000; // 2 minutes
const CRITICAL_SLA_MS = 240_000; // 4 minutes — for high-stakes issues

// Critical issue keywords — if any match, activate 4-min SLA
const CRITICAL_KEYWORDS = [
  "urgent", "emergency", "critical", "payment failed", "payment error",
  "money lost", "lost revenue", "refund", "system down", "not working",
  "broken", "crash", "cannot process", "blocked", "overbooked",
  "double book", "fraud", "chargeback", "data lost", "breach",
  "lawsuit", "legal", "regulatory", "fine", "penalty",
];

function detectIssueType(message: string): "normal" | "critical" {
  const lower = message.toLowerCase();
  return CRITICAL_KEYWORDS.some(kw => lower.includes(kw)) ? "critical" : "normal";
}

function getSlaMs(issueType: "normal" | "critical"): number {
  return issueType === "critical" ? CRITICAL_SLA_MS : NORMAL_SLA_MS;
}

function detectRevenueRisk(message: string): "low" | "medium" | "high" | "critical" {
  const lower = message.toLowerCase();
  if (["fraud", "chargeback", "lawsuit", "data breach", "penalty"].some(k => lower.includes(k))) return "critical";
  if (["payment", "revenue", "booking", "contract", "refund", "lost"].some(k => lower.includes(k))) return "high";
  if (["customer", "complaint", "cancel", "delay", "error"].some(k => lower.includes(k))) return "medium";
  return "low";
}

// Extract monetary amount at risk from user message, e.g. "£5,000" → { amount: "5000", currency: "GBP" }
function extractRevenueAtRisk(message: string): { amount: string; currency: string } | null {
  const patterns: Array<{ re: RegExp; currency: string }> = [
    { re: /£\s?([\d,]+(?:\.\d{1,2})?)/,   currency: "GBP" },
    { re: /\$\s?([\d,]+(?:\.\d{1,2})?)/,  currency: "USD" },
    { re: /€\s?([\d,]+(?:\.\d{1,2})?)/,   currency: "EUR" },
    { re: /PKR\s?([\d,]+(?:\.\d{1,2})?)/i, currency: "PKR" },
    { re: /AED\s?([\d,]+(?:\.\d{1,2})?)/i, currency: "AED" },
    { re: /([\d,]+(?:\.\d{1,2})?)\s?(?:pounds?|gbp)/i, currency: "GBP" },
    { re: /([\d,]+(?:\.\d{1,2})?)\s?(?:dollars?|usd)/i, currency: "USD" },
  ];
  for (const { re, currency } of patterns) {
    const match = message.match(re);
    if (match?.[1]) {
      const amount = match[1].replace(/,/g, "");
      if (parseFloat(amount) > 0) return { amount, currency };
    }
  }
  return null;
}

// Fire-and-forget: create resolution issue record
async function createResolutionIssue(
  userId: string, userEmail: string, industry: string,
  advisorName: string, sessionId: string | undefined,
  message: string, issueType: "normal" | "critical",
  revenueRisk: "low" | "medium" | "high" | "critical",
  slaMsTarget: number, traceId: string
): Promise<number | null> {
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");
    const now        = new Date().toISOString();
    const atRisk     = extractRevenueAtRisk(message);
    const [row] = await db.insert(aiResolutionIssues).values({
      userId,
      userEmail:            userEmail || null,
      industry,
      advisorName,
      sessionId:            sessionId ?? null,
      issueSummary:         message.slice(0, 500),
      issueType,
      status:               "active",
      revenueRiskLevel:     revenueRisk,
      revenueAtRiskAmount:  atRisk?.amount   ?? null,
      revenueAtRiskCurrency: atRisk?.currency ?? "GBP",
      stages: [
        { stage: "issue_received", timestamp: now, message: `Issue received by ${advisorName}` },
        { stage: "ai_analyzing",   timestamp: now, message: `${advisorName} is analyzing your issue` },
      ],
      slaMsTarget,
      escalatedToSherlock:  false,
      resolvedEmailSent:    false,
      traceId,
    }).returning({ id: aiResolutionIssues.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget: update resolution issue on completion
async function resolveResolutionIssue(
  issueId: number | null, userId: string, elapsedMs: number,
  escalated: boolean, userEmail: string, industry: string,
  advisorName: string, issueSummary: string, traceId: string
): Promise<void> {
  if (!issueId) return;
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { sql } = await import("drizzle-orm");
    const now = new Date().toISOString();

    const newStatus = escalated ? "sherlock_active" : "resolved";
    // Full 6-step Sherlock Auto-Import Chain stages
    const newStages = escalated
      ? [
          { stage: "analysis_completed",  timestamp: now, message: `${advisorName} analysis completed` },
          { stage: "sherlock_reviewing",   timestamp: now, message: "Sherlock reviewing — escalation in progress" },
        ]
      : [
          { stage: "analysis_completed",  timestamp: now, message: `${advisorName} analysis completed` },
          { stage: "resolved",             timestamp: now, message: "Issue resolved successfully ✓" },
        ];

    await db.update(aiResolutionIssues)
      .set({
        status:              newStatus,
        elapsedMs,
        escalatedToSherlock: escalated,
        sherlockReviewAt:    escalated ? sql`now()` : null,
        resolvedAt:          escalated ? null : sql`now()`,
        updatedAt:           sql`now()`,
        stages:              sql`stages || ${JSON.stringify(newStages)}::jsonb`,
      })
      .where(
        and(
          eq(aiResolutionIssues.id, issueId),
          eq(aiResolutionIssues.userId, userId as unknown as string)
        )
      );

    // Send resolved@ email only on successful resolution (not escalation)
    if (!escalated && userEmail) {
      sendResolvedEmail(userEmail, advisorName, industry, issueSummary, elapsedMs, traceId);
    }
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-pricing on Sherlock escalation — pricing-eligible industries only
// Fires async after escalation. Adds action_executed + revenue_protected stages.
// ─────────────────────────────────────────────────────────────────────────────
const PRICING_ELIGIBLE = new Set(["hospitality", "airlines", "car_rental", "events_entertainment", "railways"]);

async function triggerAutoPricingOnEscalation(
  issueId: number | null, userId: string, industry: string,
  issueSummary: string, traceId: string
): Promise<void> {
  if (!issueId || !PRICING_ELIGIBLE.has(industry)) return;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

    const response = await client.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are an AI pricing expert for the ${industry} industry. A customer issue has been escalated to Sherlock. Provide ONE urgent pricing action (1 sentence) that could protect or recover revenue from this issue. Be direct and specific. No markdown.`,
        },
        { role: "user", content: issueSummary.slice(0, 300) },
      ],
    });

    const action = response.choices[0]?.message?.content?.trim() ?? "Auto-pricing review initiated.";

    const { db, aiResolutionIssues } = await import("@workspace/db");
    const { eq, sql } = await import("drizzle-orm");
    const now = new Date().toISOString();
    const actionStages = [
      { stage: "action_executed",   timestamp: now, message: `Auto-pricing: ${action.slice(0, 200)}` },
      { stage: "revenue_protected", timestamp: now, message: "Revenue protection action triggered" },
    ];

    await db.update(aiResolutionIssues)
      .set({
        stages:    sql`stages || ${JSON.stringify(actionStages)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(eq(aiResolutionIssues.id, issueId));

    eventBus.broadcast("advisor.pricing_action", {
      userId, industry, issueId, action: action.slice(0, 200),
    }, traceId);
  } catch {
    // Non-fatal — pricing action is advisory only
  }
}

// Fire-and-forget: send resolved@ confirmation email to user
function sendResolvedEmail(
  userEmail: string, advisorName: string, industry: string,
  issueSummary: string, elapsedMs: number, _traceId: string
): void {
  import("../lib/mailer.js").then(({ sendMail }) => {
    const mins = (elapsedMs / 60000).toFixed(1);
    sendMail({
      to:       userEmail,
      identity: "resolved",
      subject:  `✓ Issue Resolved — ${advisorName} | HostFlow AI`,
      text: [
        `Your issue has been resolved by ${advisorName}.`,
        "",
        `Issue: ${issueSummary.slice(0, 200)}`,
        `Resolution time: ${mins} minutes`,
        `Industry: ${industry}`,
        "",
        "Your AI advisor is available 24/7 for any further questions.",
        "",
        "— HostFlow AI Resolution Engine",
        "https://www.hostflowai.net",
      ].join("\n"),
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
          <div style="background:#16a34a;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0">✓ Issue Resolved</h2>
            <p style="margin:4px 0 0;opacity:.85">${advisorName} — HostFlow AI</p>
          </div>
          <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;">
            <p style="color:#374151">Your issue has been resolved successfully.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px;color:#6b7280;font-size:14px">Issue</td><td style="padding:8px;color:#111;font-size:14px">${issueSummary.slice(0, 200)}</td></tr>
              <tr style="background:#fff"><td style="padding:8px;color:#6b7280;font-size:14px">Resolved by</td><td style="padding:8px;color:#111;font-size:14px">${advisorName}</td></tr>
              <tr><td style="padding:8px;color:#6b7280;font-size:14px">Resolution time</td><td style="padding:8px;color:#16a34a;font-size:14px;font-weight:600">${mins} minutes</td></tr>
            </table>
            <p style="color:#6b7280;font-size:13px;margin-top:24px">Your AI advisor is available 24/7 for any further questions.</p>
            <a href="https://www.hostflowai.net" style="color:#6366f1;font-size:13px">www.hostflowai.net</a>
          </div>
        </div>
      `,
    }).catch(() => {});
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/advisor/:industry  — Streaming Industry AI Advisor
// JWT required. Streams SSE chunks. Auto-escalates at 120s.
// ─────────────────────────────────────────────────────────────────────────────
// §8.4 — requireIndustryMatch runs BEFORE the handler; DB-verified, not body-trusted.
// It sets req.userProfile and injects the authoritative business_subtype for hospitality.
router.post(
  "/advisor/:industry",
  requireAuth,
  requireSurface("dashboard"),      // §5: Dashboard surface only
  requireIndustryMatch(),           // §8.3 + §8.4: DB-side industry + subtype isolation
  checkAiLimit("advisor.chat"),
  async (req: Request, res: Response) => {
  const rawIndustry = req.params["industry"] as string;
  // Normalize: both `hospitality` and legacy `tourism_hospitality` are accepted
  const industry = normalizeIndustrySlug(rawIndustry);

  if (!VALID_INDUSTRIES.includes(rawIndustry)) {
    res.status(400).json(err(
      "INVALID_INDUSTRY",
      `Invalid industry. Valid: ${VALID_INDUSTRIES.join(", ")}`,
      req.trace_id
    ));
    return;
  }

  const {
    message,
    session_id,
    // business_subtype is now DB-injected by requireIndustryMatch — never trust body value
    business_subtype,
  } = req.body as {
    message?:          string;
    session_id?:       string;
    business_subtype?: string;  // set by requireIndustryMatch from user_profiles.business_subtype
  };
  // user_industry body field is DEPRECATED — industry is now verified from DB via middleware.
  // We no longer trust the client-supplied user_industry value.

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json(err("VALIDATION_ERROR", "message is required", req.trace_id));
    return;
  }

  if (!AI_BASE_URL || !AI_API_KEY) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
    return;
  }

  const userId    = req.user!.sub;
  const email     = req.user!.email ?? "";
  const startMs   = Date.now();

  // Detect issue type + dynamic SLA
  const trimmedMsg   = message.trim();
  const issueType    = detectIssueType(trimmedMsg);
  const revenueRisk  = detectRevenueRisk(trimmedMsg);
  const slaMs        = getSlaMs(issueType);

  // Read plan from subscriptions DB — authoritative source (NOT JWT metadata)
  let plan = "trial";
  try {
    const { db, subscriptions } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [sub] = await db
      .select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId as unknown as string))
      .limit(1);
    const raw = sub?.plan ?? "trial";
    plan = raw === "pro" ? "premium" : raw;
  } catch { /* fail safe — use trial */ }

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // flush() is added by the compression middleware — call it to push SSE chunks immediately
  const flushRes = () => (res as unknown as { flush?: () => void }).flush?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flushRes();
  };

  // Heartbeat every 15s so connection stays alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
    flushRes();
  }, 15_000);

  const cleanup = () => clearInterval(heartbeat);
  req.on("close", cleanup);

  // Resolve identity + create resolution issue record before SLA timer
  const identity      = getAdvisor(industry);
  const advisorHandle = identity?.emailHandle ?? industry;
  const advisorName   = identity?.name ?? industry;

  // Fire-and-forget: create resolution issue record (returns id async)
  let resIssueId: number | null = null;
  createResolutionIssue(
    userId, email, industry, advisorName, session_id,
    trimmedMsg, issueType, revenueRisk, slaMs, req.trace_id
  ).then(id => { resIssueId = id; }).catch(() => {});

  // ── SLA timer (dynamic: 2min normal, 4min critical) ────────────────────────
  const slaTimer = setTimeout(async () => {
    cleanup();
    sendEvent("escalation", {
      escalated:    true,
      elapsed_ms:   slaMs,
      issue_type:   issueType,
      sla_ms:       slaMs,
      industry,
      message:      "Issue is being escalated to the Owner AI Advisor for immediate resolution.",
      trace_id:     req.trace_id,
    });
    await logActivity(userId, industry, trimmedMsg, null, slaMs, true, req.trace_id);
    resolveResolutionIssue(resIssueId, userId, slaMs, true, email, industry, advisorName, trimmedMsg, req.trace_id);
    res.end();
  }, slaMs);

  try {

    const [
      { recallMemory, saveConversationTurn },
      { extractAndStoreMemory },
    ] = await Promise.all([
      import("../lib/memory/recall.js"),
      import("../lib/memory/extract.js"),
    ]);

    const memory = await recallMemory(userId, advisorHandle, industry);

    const userContext: UserContext = {
      userId,
      email,
      plan,
      industry,
      businessSubtype: business_subtype,
    };
    const systemPrompt = buildIndustrySystemPrompt(industry, userContext) + memory.memoryBlock;

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

    // Send start event — includes advisor name + voice for Lovable to display
    sendEvent("start", {
      advisor:        identity?.name      ?? industry,
      advisor_role:   identity?.role      ?? industry,
      advisor_vibe:   identity?.vibe      ?? "",
      voice_id:       identity?.voiceId   ?? "",
      voice_name:     identity?.voiceName ?? "",
      industry,
      sla_ms:         slaMs,
      issue_type:     issueType,
      memory_loaded:  memory.totalMemories,
      trace_id:       req.trace_id,
    });

    req.log.info({ userId, industry, msgLen: message.length, memories: memory.totalMemories }, "Industry advisor stream started");

    // Save user turn async
    saveConversationTurn(userId, advisorHandle, industry, session_id, "user", message.trim(), "chat").catch(() => {});

    const stream = await client.chat.completions.create({
      model:  "gpt-5",
      stream: true,
      messages: [
        { role: "system",  content: systemPrompt },
        { role: "user",    content: message.trim() },
      ],
    });

    let fullResponse = "";
    let escalationDetected = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;

      fullResponse += delta;

      // Detect escalation signal inline
      if (fullResponse.includes("ESCALATING_TO_OWNER")) {
        escalationDetected = true;
      }

      sendEvent("chunk", { delta });
    }

    clearTimeout(slaTimer);
    cleanup();

    const elapsedMs = Date.now() - startMs;

    // Broadcast advisor activity to Live Feed (founder dashboard SSE)
    if (fullResponse) {
      const cleanSummary = fullResponse
        .replace(/ESCALATING_TO_OWNER/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
      eventBus.broadcast("advisor.activity", {
        advisor:   advisorName,
        industry,
        action:    `${industry} client query processed`,
        context:   cleanSummary || "Response delivered.",
        elapsed_ms: elapsedMs,
      }, req.trace_id);
    }

    // Save assistant turn + extract memory async (non-blocking)
    if (fullResponse) {
      saveConversationTurn(userId, advisorHandle, industry, session_id, "assistant", fullResponse, "chat").catch(() => {});
      extractAndStoreMemory({
        userId, advisor: advisorHandle, industry,
        userMessage: message.trim(), aiResponse: fullResponse,
        source: "chat", isEscalation: escalationDetected,
      });
      // Fire-and-forget: recalculate churn/health score after every conversation
      import("./health-scores.js").then(m => m.calculateHealthScore(userId, industry)).catch(() => {});
    }

    if (escalationDetected) {
      sendEvent("escalation", {
        escalated:        true,
        elapsed_ms:       elapsedMs,
        industry,
        issue_id:         resIssueId,
        escalating_to:    OWNER_ADVISOR.name,
        escalating_voice: OWNER_ADVISOR.voiceId,
        message:          `${advisorName} is handing this to ${OWNER_ADVISOR.name} — resolution incoming.`,
        trace_id:         req.trace_id,
      });
      await logActivity(userId, industry, trimmedMsg, fullResponse, elapsedMs, true, req.trace_id);
      resolveResolutionIssue(resIssueId, userId, elapsedMs, true, email, industry, advisorName, trimmedMsg, req.trace_id);
      eventBus.broadcast("advisor.escalated", { userId, industry, elapsed_ms: elapsedMs, issue_id: resIssueId }, req.trace_id);
      // Auto-pricing: fire-and-forget for pricing-eligible industries
      triggerAutoPricingOnEscalation(resIssueId, userId, industry, trimmedMsg, req.trace_id);
    } else {
      sendEvent("done", {
        elapsed_ms:  elapsedMs,
        sla_met:     elapsedMs < slaMs,
        issue_type:  issueType,
        industry,
        advisor:     advisorName,
        memory_size: memory.totalMemories,
        trace_id:    req.trace_id,
      });
      await logActivity(userId, industry, trimmedMsg, fullResponse, elapsedMs, false, req.trace_id);
      resolveResolutionIssue(resIssueId, userId, elapsedMs, false, email, industry, advisorName, trimmedMsg, req.trace_id);
      eventBus.broadcast("advisor.resolved", { userId, industry, elapsed_ms: elapsedMs }, req.trace_id);
    }

    req.log.info({ userId, industry, elapsedMs, escalated: escalationDetected }, "Industry advisor stream done");

  } catch (e) {
    clearTimeout(slaTimer);
    cleanup();
    req.log.error({ err: e, industry }, "Industry advisor stream error");
    sendEvent("error", {
      code:    "AI_ERROR",
      message: "Advisor encountered an error. Escalating to Owner AI Advisor.",
      trace_id: req.trace_id,
    });
    await logActivity(userId, industry, message, null, Date.now() - startMs, true, req.trace_id);
  }

  res.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/advisor/escalate  — Industry Advisor → Owner AI Advisor
// Called automatically when industry advisor cannot resolve in 120s
// ─────────────────────────────────────────────────────────────────────────────
router.post("/advisor/escalate", requireAuth, async (req: Request, res: Response) => {
  const {
    industry,
    original_query,
    advisor_attempts,
    elapsed_ms,
  } = req.body as {
    industry:         string;
    original_query:   string;
    advisor_attempts: string[];
    elapsed_ms:       number;
  };

  if (!industry || !original_query) {
    res.status(400).json(err("VALIDATION_ERROR", "industry and original_query are required", req.trace_id));
    return;
  }

  if (!AI_BASE_URL || !AI_API_KEY) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
    return;
  }

  const userId  = req.user!.sub;
  const startMs = Date.now();

  // ── SSE stream for escalation ──────────────────────────────────────────────
  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const flushRes = () => (res as unknown as { flush?: () => void }).flush?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flushRes();
  };

  const heartbeat = setInterval(() => { res.write(": heartbeat\n\n"); flushRes(); }, 15_000);
  req.on("close", () => clearInterval(heartbeat));

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

    const escalationPrompt = `You are the Owner AI Advisor — the head of the HostFlow AI support network. 
A dedicated ${ADVISOR_NAME_BY_INDUSTRY[industry] ?? industry} Advisor has escalated an unresolved issue to you.

ESCALATION DETAILS
- Industry: ${industry}
- User ID: ${userId}
- Time already spent by Industry Advisor: ${elapsed_ms}ms
- Original query: ${original_query}
- Advisor attempts: ${(advisor_attempts ?? []).join(" | ") || "None recorded"}

Your job:
1. Resolve this issue definitively — you have full authority.
2. Return a clear resolution the Industry Advisor can relay to the user.
3. Specify any action taken (e.g., fixed_db_constraint, refunded, rebooked, config_updated).
4. Provide a user-facing email template summary (2-3 lines) for the confirmation email.

Be direct, authoritative, and complete. This user has waited — make it right.`;

    sendEvent("start", {
      escalated_to: "Owner AI Advisor",
      industry,
      trace_id:     req.trace_id,
    });

    const stream = await client.chat.completions.create({
      model:                 "gpt-5",
      max_completion_tokens: 1024,
      stream:                true,
      messages: [
        { role: "system", content: escalationPrompt },
        { role: "user",   content: original_query },
      ],
    });

    let fullResolution = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;
      fullResolution += delta;
      sendEvent("chunk", { delta });
    }

    clearInterval(heartbeat);
    const totalMs = Date.now() - startMs;

    sendEvent("resolved", {
      resolution:     fullResolution,
      action_taken:   "owner_advisor_resolved",
      send_back_to:   industry,
      elapsed_ms:     totalMs,
      trace_id:       req.trace_id,
    });

    await logEscalation(userId, industry, original_query, fullResolution, elapsed_ms + totalMs, req.trace_id);

    req.log.info({ userId, industry, totalMs }, "Escalation resolved by Owner AI Advisor");

  } catch (e) {
    clearInterval(heartbeat);
    req.log.error({ err: e }, "Owner advisor escalation failed");
    sendEvent("error", {
      code:     "OWNER_ADVISOR_ERROR",
      message:  "Owner AI Advisor encountered an error. Please contact naumansherwani@hostflowai.net directly.",
      trace_id: req.trace_id,
    });
  }

  res.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/advisor/industries  — Full advisor roster with names + voice IDs
// ─────────────────────────────────────────────────────────────────────────────
router.get("/advisor/industries", (_req, res) => {
  res.json(
    ok(
      {
        advisors:          getAllAdvisors(),
        owner_advisor:     OWNER_ADVISOR,
        escalation_chain:  ESCALATION_CHAIN,
        total:             getAllAdvisors().length,
      },
      "advisor-industries"
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function logActivity(
  userId:     string,
  industry:   string,
  query:      string,
  response:   string | null,
  elapsedMs:  number,
  escalated:  boolean,
  traceId:    string
) {
  try {
    const { db, events } = await import("@workspace/db");
    await db.insert(events).values({
      eventType: "advisor.activity",
      payload: {
        user_id:               userId,
        industry,
        query:                 query.slice(0, 500),
        response_preview:      response?.slice(0, 200) ?? null,
        time_to_resolve_ms:    elapsedMs,
        sla_met:               elapsedMs < NORMAL_SLA_MS,
        escalated_to_owner:    escalated,
        revenue_suggestion_made: response?.includes("💡 Revenue Opportunity") ?? false,
        trace_id:              traceId,
      },
    });
  } catch {
    // Non-fatal — don't break the stream
  }
}

async function logEscalation(
  userId:        string,
  industry:      string,
  originalQuery: string,
  resolution:    string,
  totalMs:       number,
  traceId:       string
) {
  try {
    const { db, events } = await import("@workspace/db");
    await db.insert(events).values({
      eventType: "advisor.escalation",
      payload: {
        user_id:             userId,
        industry,
        original_query:      originalQuery.slice(0, 500),
        owner_resolution:    resolution.slice(0, 500),
        time_to_resolve_ms:  totalMs,
        escalated_to_owner:  true,
        trace_id:            traceId,
      },
    });
  } catch {
    // Non-fatal
  }
}

export default router;
