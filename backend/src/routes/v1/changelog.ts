import { Router, type IRouter } from "express";
import { ok, err } from "../../lib/response.js";
import { eventBus } from "../../lib/event-bus.js";

const router: IRouter = Router();

interface ChangelogPayload {
  version?: string;
  source?: string;
  industries?: Record<string, {
    ai_name?: string;
    features?: string[];
    pages?: string[];
    [key: string]: unknown;
  }>;
  owner_dashboard?: Record<string, unknown>;
  frontend_routes?: string[];
  edge_layer?: Record<string, unknown>;
  changelog?: unknown[];
  [key: string]: unknown;
}

router.post("/changelog", async (req, res) => {
  const body = req.body as ChangelogPayload;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json(err("VALIDATION_ERROR", "Changelog payload must be a JSON object", req.trace_id));
    return;
  }

  try {
    const { db, siteManifest } = await import("@workspace/db");

    const industryCount  = body.industries ? Object.keys(body.industries).length : 0;
    const routeCount     = Array.isArray(body.frontend_routes) ? body.frontend_routes.length : 0;
    const changelogCount = Array.isArray(body.changelog) ? body.changelog.length : 0;

    await db.insert(siteManifest).values({
      source:  body.source ?? "lovable",
      version: body.version ?? null,
      payload: body as Record<string, unknown>,
    });

    // ── Instant push to ALL SSE listeners — Replit brain confirmed handoff ───
    eventBus.broadcast("handoff_ack", {
      version:          body.version ?? "unversioned",
      industries_count: industryCount,
      routes_count:     routeCount,
      changelog_count:  changelogCount,
      brain_status:     "synced",
      source:           "replit_brain",
    }, req.trace_id);

    req.log.info({ version: body.version, industryCount, routeCount }, "Changelog handoff received from Lovable");

    res.json(ok({
      handoff_ack:      true,
      received_at:      new Date().toISOString(),
      version:          body.version ?? "unversioned",
      industries_acked: industryCount,
      routes_acked:     routeCount,
      changelog_acked:  changelogCount,
      brain_status:     "synced",
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Changelog storage failed");
    res.status(500).json(err("DB_ERROR", "Failed to store changelog", req.trace_id));
  }
});

router.get("/changelog/latest", async (req, res) => {
  try {
    const { db, siteManifest } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(siteManifest)
      .orderBy(desc(siteManifest.receivedAt))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json(err("NOT_FOUND", "No changelog received yet", req.trace_id));
      return;
    }

    res.json(ok({
      id:          rows[0].id,
      source:      rows[0].source,
      version:     rows[0].version,
      received_at: rows[0].receivedAt,
      payload:     rows[0].payload,
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Changelog fetch failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch changelog", req.trace_id));
  }
});

router.get("/changelog/history", async (req, res) => {
  try {
    const { db, siteManifest } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    const rows = await db
      .select({
        id:         siteManifest.id,
        source:     siteManifest.source,
        version:    siteManifest.version,
        receivedAt: siteManifest.receivedAt,
      })
      .from(siteManifest)
      .orderBy(desc(siteManifest.receivedAt))
      .limit(20);

    res.json(ok({ total: rows.length, changelogs: rows }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Changelog history fetch failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch changelog history", req.trace_id));
  }
});

export default router;
