import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";
import { buildOwnerSystemPrompt, type BusinessSnapshot } from "../lib/owner-advisor-prompt.js";
import { eventBus } from "../lib/event-bus.js";

const router: IRouter = Router();

const MAX_HISTORY_IN_CONTEXT = 500;

async function ownerAdvisorHandler(req: import("express").Request, res: import("express").Response): Promise<void> {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json(err("VALIDATION_ERROR", "message is required", req.trace_id));
    return;
  }

  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

  if (!baseUrl || !apiKey) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
    return;
  }

  const userId = req.user!.sub;

  try {
    const { db, subscriptions, events, founderAdvisorHistory, siteManifest, planFeatureLimits } =
      await import("@workspace/db");
    const { sql, eq, desc } = await import("drizzle-orm");

    const [
      subStats,
      eventStats,
      historyCount,
      sizeRow,
      recentHistory,
      latestManifest,
      planLimitsRows,
    ] = await Promise.all([
      // Subscription breakdown per plan
      db.select({
        total:    sql<number>`count(*)::int`,
        active:   sql<number>`count(*) filter (where status = 'active')::int`,
        trial:    sql<number>`count(*) filter (where plan = 'trial')::int`,
        basic:    sql<number>`count(*) filter (where plan = 'basic')::int`,
        pro:      sql<number>`count(*) filter (where plan in ('pro','standard'))::int`,
        premium:  sql<number>`count(*) filter (where plan = 'premium')::int`,
      }).from(subscriptions),

      // Total events
      db.select({ total: sql<number>`count(*)::int` }).from(events),

      // Advisor history count for this user
      db.select({ total: sql<number>`count(*)::int` })
        .from(founderAdvisorHistory)
        .where(eq(founderAdvisorHistory.userId, userId)),

      // DB size
      db.execute(sql`SELECT ROUND(pg_database_size(current_database()) / 1024.0) as size_kb`),

      // Last N conversations (reversed for chronological order)
      db.select({ role: founderAdvisorHistory.role, content: founderAdvisorHistory.content })
        .from(founderAdvisorHistory)
        .where(eq(founderAdvisorHistory.userId, userId))
        .orderBy(desc(founderAdvisorHistory.createdAt))
        .limit(MAX_HISTORY_IN_CONTEXT),

      // Latest Lovable site manifest
      db.select({ payload: siteManifest.payload, version: siteManifest.version })
        .from(siteManifest)
        .orderBy(desc(siteManifest.receivedAt))
        .limit(1),

      // All plan feature limits
      db.select().from(planFeatureLimits),
    ]);

    const stats = subStats[0];

    const snapshot: BusinessSnapshot = {
      totalSubscriptions:   stats?.total    ?? 0,
      activeSubscriptions:  stats?.active   ?? 0,
      trialUsers:           stats?.trial    ?? 0,
      basicUsers:           stats?.basic    ?? 0,
      proUsers:             stats?.pro      ?? 0,
      premiumUsers:         stats?.premium  ?? 0,
      totalEvents:          eventStats[0]?.total ?? 0,
      totalAdvisorMessages: historyCount[0]?.total ?? 0,
      dbSizeKb:             Number((sizeRow.rows[0] as { size_kb: string })?.size_kb ?? 0),
      uptimeSeconds:        Math.floor(process.uptime()),
      serverTime:           new Date().toISOString(),
      siteManifest:         (latestManifest[0]?.payload as Record<string, unknown>) ?? null,
      planLimits:           planLimitsRows,
    };

    // Load Sherlock's memory vault for this founder
    const { recallMemory, saveConversationTurn } = await import("../lib/memory/recall.js");
    const { extractAndStoreMemory } = await import("../lib/memory/extract.js");
    const memory = await recallMemory(userId, "sherlock", "owner");

    const systemPrompt = buildOwnerSystemPrompt(snapshot) + memory.memoryBlock;
    const chronologicalHistory = [...recentHistory].reverse() as {
      role: "user" | "assistant";
      content: string;
    }[];

    // Store user message (both founderAdvisorHistory + new memory system)
    await db.insert(founderAdvisorHistory).values({
      userId,
      role:    "user",
      content: message.trim(),
    });
    saveConversationTurn(userId, "sherlock", "owner", undefined, "user", message.trim(), "chat").catch(() => {});

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ baseURL: baseUrl, apiKey });

    req.log.info(
      { userId, historyInContext: chronologicalHistory.length, totalStored: snapshot.totalAdvisorMessages, msgLen: message.length },
      "Owner advisor request"
    );

    const response = await client.chat.completions.create({
      model:                 "gpt-5",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        ...chronologicalHistory,
        { role: "user",   content: message.trim() },
      ],
    });

    const aiResponse = response.choices[0]?.message?.content ?? "";
    const tokensUsed  = response.usage?.total_tokens ?? 0;

    // Store assistant reply (both systems)
    await db.insert(founderAdvisorHistory).values({
      userId,
      role:    "assistant",
      content: aiResponse,
    });
    saveConversationTurn(userId, "sherlock", "owner", undefined, "assistant", aiResponse, "chat").catch(() => {});
    extractAndStoreMemory({ userId, advisor: "sherlock", industry: "owner", userMessage: message.trim(), aiResponse, source: "chat" });

    // Broadcast Sherlock activity to Live Feed (founder dashboard SSE)
    if (aiResponse) {
      const cleanSummary = aiResponse.replace(/\s+/g, " ").trim().slice(0, 140);
      eventBus.broadcast("advisor.activity", {
        advisor:  "Sherlock",
        industry: "owner",
        action:   "Owner advisory query processed",
        context:  cleanSummary || "Strategic analysis delivered.",
        elapsed_ms: tokensUsed,
      }, req.trace_id);
    }

    res.json(ok({
      response:    aiResponse,
      model:       response.model,
      tokens_used: tokensUsed,
      snapshot: {
        total_subscriptions:  snapshot.totalSubscriptions,
        active_subscriptions: snapshot.activeSubscriptions,
        trial:    snapshot.trialUsers,
        basic:    snapshot.basicUsers,
        pro:      snapshot.proUsers,
        premium:  snapshot.premiumUsers,
      },
      memory: {
        messages_stored:     snapshot.totalAdvisorMessages + 2,
        messages_in_context: chronologicalHistory.length + 1,
        vault_memories:      memory.totalMemories,
        max_conversations:   50000,
      },
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Owner advisor failed");
    res.status(500).json(err("AI_ERROR", "Advisor processing failed. Please try again.", req.trace_id));
  }
}

// Register both paths — same handler
router.post("/owner/advisor",   requireAuth, ownerAdvisorHandler);
router.post("/founder/adviser", requireAuth, ownerAdvisorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/owner/policy/broadcast  — Founder triggers policy.updated SSE
// Lovable LiveFeed + useAiPricing listen for this to invalidate caches
// Admin only (role = admin)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/owner/policy/broadcast", requireAuth, async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") {
    res.status(403).json(err("FORBIDDEN", "Admin only", req.trace_id));
    return;
  }
  const { policy_type = "general", message, industry } = req.body as {
    policy_type?: string; message?: string; industry?: string;
  };
  eventBus.broadcast("policy.updated", {
    policy_type,
    message:    message?.slice(0, 500) ?? "Policy updated by Founder",
    industry:   industry ?? null,
    updated_by: req.user!.sub,
    updated_at: new Date().toISOString(),
  }, req.trace_id);
  res.json(ok({ broadcasted: true, policy_type }, req.trace_id));
});

export default router;
