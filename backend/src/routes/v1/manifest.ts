import { Router, type IRouter } from "express";
import { ok, err } from "../../lib/response.js";
import { eventBus } from "../../lib/event-bus.js";
import { randomUUID } from "crypto";
import { VALID_INDUSTRIES as INDUSTRY_SLUGS } from "../../lib/industry-advisor-prompts.js";

const router: IRouter = Router();

interface ManifestPayload {
  industry?: string;
  page?: string;
  user_id?: string;
  session_id?: string;
  ui_state?: Record<string, unknown>;
  version?: string;
}

const VALID_INDUSTRIES = [...INDUSTRY_SLUGS, "general"];

const UI_FLAGS_BY_PAGE: Record<string, Record<string, unknown>> = {
  dashboard:  { show_ai_advisor: true,  play_welcome_voice: false, show_revenue_chart: true },
  login:      { show_ai_advisor: false, play_welcome_voice: true,  show_revenue_chart: false },
  signup:     { show_ai_advisor: false, play_welcome_voice: true,  show_revenue_chart: false },
  pricing:    { show_ai_advisor: true,  play_welcome_voice: false, highlight_recommended: true },
  analytics:  { show_ai_advisor: true,  play_welcome_voice: false, show_revenue_chart: true },
  settings:   { show_ai_advisor: false, play_welcome_voice: false, show_revenue_chart: false },
  default:    { show_ai_advisor: true,  play_welcome_voice: false, show_revenue_chart: false },
};

const activeManifests = new Map<string, { manifest: ManifestPayload; receivedAt: string }>();

router.post("/sync-manifest", (req, res) => {
  const body = req.body as ManifestPayload;

  if (body.industry && !VALID_INDUSTRIES.includes(body.industry)) {
    res.status(400).json(
      err("VALIDATION_ERROR", `Invalid industry: ${body.industry}`, req.trace_id)
    );
    return;
  }

  const sessionId = body.session_id ?? randomUUID();
  const page      = body.page ?? "default";
  const industry  = body.industry ?? "general";

  activeManifests.set(sessionId, { manifest: body, receivedAt: new Date().toISOString() });
  if (activeManifests.size > 1000) {
    const firstKey = activeManifests.keys().next().value;
    if (firstKey) activeManifests.delete(firstKey);
  }

  const uiFlags = {
    ...(UI_FLAGS_BY_PAGE[page] ?? UI_FLAGS_BY_PAGE["default"]),
    voice_trigger:     page === "login" || page === "signup",
    industry_context:  industry,
    session_id:        sessionId,
    manifest_accepted: true,
    server_version:    "1.0.0",
  };

  // ── Instant push to all SSE listeners ──────────────────────────────────────
  eventBus.broadcast("manifest_synced", {
    industry,
    page,
    session_id:  sessionId,
    ui_flags:    uiFlags,
    source:      "lovable",
  }, req.trace_id);

  req.log.info({ industry, page, sessionId }, "Manifest synced from Lovable");

  res.json(ok({ synced: true, session_id: sessionId, industry, page, ui_flags: uiFlags }, req.trace_id));
});

router.get("/sync-manifest/status", (req, res) => {
  res.json(ok({
    active_sessions:   activeManifests.size,
    sse_clients_live:  eventBus.connectedCount,
    server_time:       new Date().toISOString(),
  }, req.trace_id));
});

export default router;
