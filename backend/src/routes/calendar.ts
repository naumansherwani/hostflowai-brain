// ─────────────────────────────────────────────────────────────────────────────
// AI Calendar / Smart Scheduling Engine
// GPT-5 powered schedule optimization for all 8 industries.
// checkAiLimit("calendar.ai") — monthly cap per plan.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { checkAiLimit } from "../middleware/check-ai-limit.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

// Industry-specific slot type labels
const INDUSTRY_SLOT_TYPES: Record<string, string[]> = {
  hospitality:          ["room_checkin", "tour_departure", "room_checkout", "housekeeping"],
  airlines:             ["flight_departure", "flight_arrival", "boarding", "gate_change"],
  car_rental:           ["vehicle_pickup", "vehicle_return", "maintenance_window"],
  healthcare:           ["appointment", "surgery", "consultation", "followup"],
  education:            ["class_session", "exam", "lab_session", "tutorial"],
  logistics:            ["pickup", "delivery", "warehouse_slot", "customs_check"],
  events_entertainment: ["event_start", "event_end", "setup", "teardown", "rehearsal"],
  railways:             ["departure", "arrival", "maintenance", "crew_change"],
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calendar/slots  — Available + booked slot grid
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/calendar/slots",
  requireAuth,
  requireSurface("dashboard"),
  async (req: Request, res: Response) => {
    const { start_date, end_date, resource_id, resource_type } = req.query as Record<string, string>;
    if (!start_date || !end_date) {
      res.status(400).json(err("VALIDATION_ERROR", "start_date and end_date required (ISO format)", req.trace_id));
      return;
    }

    try {
      const { db } = await import("@workspace/db");

      // Get booked slots from DB
      const booked = await db.execute(sql`
        SELECT
          id, resource_id, resource_name, resource_type,
          start_time, end_time, guest_name, guest_email,
          party_size, status, industry, amount, currency
        FROM bookings
        WHERE user_id = ${req.user!.sub}
          AND start_time >= ${start_date}::timestamptz
          AND end_time   <= ${end_date}::timestamptz
          AND status NOT IN ('cancelled', 'no_show')
          ${resource_id   ? sql`AND resource_id = ${resource_id}` : sql``}
          ${resource_type ? sql`AND resource_type = ${resource_type}` : sql``}
        ORDER BY start_time ASC
      `);

      // Get resources for context
      const resources = await db.execute(sql`
        SELECT id, resource_type, resource_name, external_id,
               total_capacity, current_capacity, status, base_rate, currency
        FROM resources
        WHERE user_id = ${req.user!.sub}
          AND is_active = true
          ${resource_id   ? sql`AND external_id = ${resource_id}` : sql``}
          ${resource_type ? sql`AND resource_type = ${resource_type}` : sql``}
        ORDER BY resource_name ASC
      `);

      res.json(ok({
        window:    { start_date, end_date },
        booked:    booked.rows ?? [],
        resources: resources.rows ?? [],
        total_booked: (booked.rows ?? []).length,
        total_resources: (resources.rows ?? []).length,
      }, req.trace_id));

    } catch (e) {
      req.log.error({ err: e }, "calendar slots failed");
      res.status(500).json(err("DB_ERROR", "Failed to fetch calendar slots", req.trace_id));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calendar/suggest  — AI schedule optimization
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/calendar/suggest",
  requireAuth,
  requireSurface("dashboard"),
  checkAiLimit("calendar.ai"),
  async (req: Request, res: Response) => {
    const {
      industry, date_range_start, date_range_end,
      constraints, objectives, current_schedule,
      resource_types, staff_count,
    } = req.body as Record<string, unknown>;

    if (!industry || !date_range_start || !date_range_end) {
      res.status(400).json(err("VALIDATION_ERROR", "industry, date_range_start, date_range_end required", req.trace_id));
      return;
    }

    if (!AI_BASE_URL || !AI_API_KEY) {
      res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
      return;
    }

    const industryStr  = String(industry).toLowerCase();
    const slotTypes    = INDUSTRY_SLOT_TYPES[industryStr] ?? ["slot", "appointment", "booking"];

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

      const contextLines = [
        `Industry: ${industry}`,
        `Date range: ${date_range_start} to ${date_range_end}`,
        `Slot types for this industry: ${slotTypes.join(", ")}`,
        staff_count    ? `Staff count: ${staff_count}` : null,
        resource_types ? `Resource types: ${JSON.stringify(resource_types)}` : null,
        constraints    ? `Constraints: ${JSON.stringify(constraints)}` : null,
        objectives     ? `Objectives: ${JSON.stringify(objectives)}` : null,
        current_schedule ? `Current schedule summary: ${JSON.stringify(current_schedule)}` : null,
      ].filter(Boolean).join("\n");

      const prompt = `You are HostFlow AI Smart Scheduling Engine for ${industry} industry.
Analyze the scheduling data and provide optimization suggestions.

${contextLines}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "suggestions": [
    {
      "title": "<actionable suggestion title>",
      "description": "<detailed explanation>",
      "priority": "urgent|high|medium|low",
      "slot_type": "<slot type from: ${slotTypes.join(", ")}>",
      "recommended_time": "<ISO datetime or time range>",
      "impact": "<expected business impact>",
      "revenue_impact": "<estimated revenue impact if applicable>"
    }
  ],
  "gaps": ["<identified scheduling gap>"],
  "urgent_alerts": ["<urgent issue needing immediate attention>"],
  "optimization_score": <0-100>,
  "summary": "<2-3 sentence executive summary>"
}`;

      const response = await client.chat.completions.create({
        model: "gpt-5",
        messages: [
          { role: "system", content: prompt },
          { role: "user",   content: "Provide schedule optimization." },
        ],
      });

      const rawContent = response.choices[0]?.message?.content?.trim() ?? "";
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(rawContent);
      } catch {
        result = { suggestions: [], gaps: [], urgent_alerts: ["AI response parsing failed — please retry"], optimization_score: 0, summary: rawContent };
      }

      res.json(ok({
        ...result,
        industry:   industryStr,
        slot_types: slotTypes,
        date_range: { start: date_range_start, end: date_range_end },
        generated_at: new Date().toISOString(),
      }, req.trace_id));

    } catch (e) {
      req.log.error({ err: e }, "calendar suggest failed");
      res.status(500).json(err("CALENDAR_ERROR", "AI scheduling suggestion failed", req.trace_id));
    }
  }
);

export default router;
