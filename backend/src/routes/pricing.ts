// ─────────────────────────────────────────────────────────────────────────────
// AI Smart Pricing Engine
// GPT-5 powered price recommendations for 5 pricing industries.
// BLOCKED for healthcare, education, logistics (403 PRICING_NOT_AVAILABLE).
// Uses checkAiLimit("pricing.ai") — monthly cap per plan.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { requireIndustryMatch } from "../middleware/require-industry-match.js";
import { checkAiLimit } from "../middleware/check-ai-limit.js";
import { ok, err } from "../lib/response.js";
import { eventBus } from "../lib/event-bus.js";

const router: IRouter = Router();

const PRICING_BLOCKED = new Set(["healthcare", "education", "logistics"]);

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pricing/suggest  — AI price recommendation
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/pricing/suggest",
  requireAuth,
  requireSurface("dashboard"),
  requireIndustryMatch({ checkBody: true }),
  checkAiLimit("pricing.ai"),
  async (req: Request, res: Response) => {
    const {
      industry, resource_type, resource_name,
      current_price, currency = "USD",
      occupancy_rate, competitor_rate, season, demand_level,
      additional_context,
    } = req.body as Record<string, unknown>;

    if (!industry) {
      res.status(400).json(err("VALIDATION_ERROR", "industry required", req.trace_id));
      return;
    }

    const industryStr = String(industry).toLowerCase();
    if (PRICING_BLOCKED.has(industryStr)) {
      res.status(403).json(err(
        "PRICING_NOT_AVAILABLE",
        `AI Smart Pricing is not available for ${industry}. This feature is for hospitality, airlines, car rental, events, and railways only.`,
        req.trace_id
      ));
      return;
    }

    if (!AI_BASE_URL || !AI_API_KEY) {
      res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
      return;
    }

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

      const contextLines = [
        `Industry: ${industry}`,
        resource_type  ? `Resource type: ${resource_type}` : null,
        resource_name  ? `Resource name: ${resource_name}` : null,
        current_price  ? `Current price: ${current_price} ${currency}` : null,
        occupancy_rate ? `Occupancy rate: ${occupancy_rate}%` : null,
        competitor_rate? `Competitor rate: ${competitor_rate} ${currency}` : null,
        season         ? `Season: ${season}` : null,
        demand_level   ? `Demand level: ${demand_level}` : null,
        additional_context ? `Context: ${additional_context}` : null,
      ].filter(Boolean).join("\n");

      const prompt = `You are HostFlow AI Smart Pricing Engine. Analyze the following data and provide a price recommendation.

${contextLines}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "suggested_price": <number>,
  "currency": "${currency}",
  "confidence": "high|medium|low",
  "rationale": "<2-3 sentences explaining the recommendation>",
  "price_range": { "min": <number>, "max": <number> },
  "strategy": "<pricing strategy name>",
  "alerts": ["<optional alert 1>", "<optional alert 2>"]
}`;

      const response = await client.chat.completions.create({
        model: "gpt-5",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Provide price recommendation." },
        ],
      });

      const rawContent = response.choices[0]?.message?.content?.trim() ?? "";
      let suggestion: Record<string, unknown>;
      try {
        suggestion = JSON.parse(rawContent);
      } catch {
        suggestion = { suggested_price: null, rationale: rawContent, confidence: "low", alerts: ["AI response could not be parsed — manual review recommended"] };
      }

      // Store in pricing_suggestions
      const { db } = await import("@workspace/db");
      const [stored] = (await db.execute(sql`
        INSERT INTO pricing_suggestions (user_id, industry, resource_type, input_data, suggested_price, currency, rationale, confidence)
        VALUES (
          ${req.user!.sub}, ${industryStr},
          ${(resource_type ?? null) as string | null},
          ${JSON.stringify({ resource_name, current_price, occupancy_rate, competitor_rate, season, demand_level, additional_context })}::jsonb,
          ${(suggestion["suggested_price"] ?? null) as number | null},
          ${currency as string},
          ${(suggestion["rationale"] ?? null) as string | null},
          ${(suggestion["confidence"] ?? null) as string | null}
        )
        RETURNING id, created_at
      `)).rows;

      // Broadcast pricing config updated — Lovable useAiPricing hook listens for cache invalidation
      eventBus.broadcast("pricing.config_updated", {
        userId:    req.user!.sub,
        industry:  industryStr,
        suggested: suggestion["suggested_price"] ?? null,
        confidence: suggestion["confidence"] ?? null,
      }, req.trace_id);

      res.json(ok({
        ...suggestion,
        suggestion_id: (stored as Record<string, unknown>)?.["id"],
        industry: industryStr,
        resource_type: resource_type ?? null,
        resource_name: resource_name ?? null,
        input: { current_price, occupancy_rate, competitor_rate, season, demand_level },
        generated_at: new Date().toISOString(),
      }, req.trace_id));

    } catch (e) {
      req.log.error({ err: e }, "pricing suggest failed");
      res.status(500).json(err("PRICING_ERROR", "AI pricing suggestion failed", req.trace_id));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pricing/history  — Past pricing suggestions
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/pricing/history",
  requireAuth,
  requireSurface("dashboard"),
  async (req: Request, res: Response) => {
    const limit  = Math.min(Number(req.query["limit"]  ?? 20), 100);
    const offset = Number(req.query["offset"] ?? 0);
    const industry = req.query["industry"] as string | undefined;

    try {
      const { db } = await import("@workspace/db");
      const rows = await db.execute(sql`
        SELECT id, industry, resource_type, suggested_price, currency,
               rationale, confidence, input_data, created_at
        FROM pricing_suggestions
        WHERE user_id = ${req.user!.sub}
          ${industry ? sql`AND industry = ${industry}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      res.json(ok({ history: rows.rows ?? [], limit, offset, count: (rows.rows ?? []).length }, req.trace_id));
    } catch (e) {
      req.log.error({ err: e }, "pricing history failed");
      res.status(500).json(err("DB_ERROR", "Failed to fetch pricing history", req.trace_id));
    }
  }
);

export default router;
