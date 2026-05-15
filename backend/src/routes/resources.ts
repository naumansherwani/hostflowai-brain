import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

const VALID_STATUSES = new Set(["active", "inactive", "maintenance", "retired"]);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resources/fleet/summary  — Fleet summary per resource_type
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resources/fleet/summary", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT
        resource_type,
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE status = 'active')         AS active,
        COUNT(*) FILTER (WHERE status = 'maintenance')    AS in_maintenance,
        COUNT(*) FILTER (WHERE status = 'inactive')       AS inactive,
        COUNT(*) FILTER (WHERE status = 'retired')        AS retired,
        AVG(base_rate)                                    AS avg_base_rate,
        MIN(base_rate)                                    AS min_rate,
        MAX(base_rate)                                    AS max_rate,
        MAX(currency)                                     AS currency
      FROM resources
      WHERE user_id = ${req.user!.sub} AND is_active = true
      GROUP BY resource_type
      ORDER BY total DESC
    `);
    res.json(ok({ summary: rows.rows ?? [], by_type: (rows.rows ?? []).length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "fleet summary failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch fleet summary", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resources/availability  — Resources with booking status in a range
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resources/availability", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const { start_time, end_time, resource_type } = req.query as Record<string, string>;
  if (!start_time || !end_time) {
    res.status(400).json(err("VALIDATION_ERROR", "start_time and end_time required", req.trace_id));
    return;
  }
  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT r.*,
        CASE WHEN b.id IS NOT NULL THEN 'booked' ELSE 'available' END AS availability_status,
        b.id AS active_booking_id,
        b.guest_name AS booked_by,
        b.start_time AS booking_start,
        b.end_time   AS booking_end
      FROM resources r
      LEFT JOIN bookings b
        ON b.resource_id = r.external_id
        AND b.status NOT IN ('cancelled','no_show')
        AND b.start_time < ${end_time}::timestamptz
        AND b.end_time   > ${start_time}::timestamptz
        AND b.user_id = ${req.user!.sub}
      WHERE r.user_id = ${req.user!.sub}
        AND r.is_active = true
        ${resource_type ? sql`AND r.resource_type = ${resource_type}` : sql``}
      ORDER BY r.resource_name ASC
    `);
    res.json(ok({ resources: rows.rows ?? [], count: (rows.rows ?? []).length, window: { start_time, end_time } }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "availability fetch failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch availability", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/resources  — Create resource
// ─────────────────────────────────────────────────────────────────────────────
router.post("/resources", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const {
    industry, business_subtype, resource_type, resource_name, external_id,
    total_capacity, current_capacity, base_rate, currency = "USD",
    location_label, location_city, location_country, metadata = {},
  } = req.body as Record<string, unknown>;

  if (!industry || !resource_type || !resource_name) {
    res.status(400).json(err("VALIDATION_ERROR", "industry, resource_type, resource_name required", req.trace_id));
    return;
  }
  try {
    const { db } = await import("@workspace/db");
    const result = await db.execute(sql`
      INSERT INTO resources (
        user_id, industry, business_subtype, resource_type, resource_name, external_id,
        total_capacity, current_capacity, base_rate, currency,
        location_label, location_city, location_country, metadata
      ) VALUES (
        ${req.user!.sub}, ${industry as string}, ${(business_subtype ?? null) as string | null},
        ${resource_type as string}, ${resource_name as string},
        ${(external_id ?? null) as string | null},
        ${(total_capacity ?? null) as number | null}, ${(current_capacity ?? null) as number | null},
        ${(base_rate ?? null) as number | null}, ${currency as string},
        ${(location_label ?? null) as string | null}, ${(location_city ?? null) as string | null},
        ${(location_country ?? null) as string | null}, ${JSON.stringify(metadata)}::jsonb
      )
      RETURNING *
    `);
    res.status(201).json(ok(result.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "resource create failed");
    res.status(500).json(err("DB_ERROR", "Failed to create resource", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resources  — List resources
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resources", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const resource_type = req.query["resource_type"] as string | undefined;
  const status = req.query["status"] as string | undefined;

  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT * FROM resources
      WHERE user_id = ${req.user!.sub}
        AND is_active = true
        ${resource_type ? sql`AND resource_type = ${resource_type}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY resource_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    res.json(ok({ resources: rows.rows ?? [], limit, offset, count: (rows.rows ?? []).length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "resources list failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch resources", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/resources/:id  — Update resource
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/resources/:id", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!id) { res.status(400).json(err("VALIDATION_ERROR", "Invalid id", req.trace_id)); return; }
  const { resource_name, base_rate, total_capacity, current_capacity, location_label, maintenance_note, maintenance_due, metadata } = req.body as Record<string, unknown>;
  try {
    const { db } = await import("@workspace/db");
    const result = await db.execute(sql`
      UPDATE resources SET
        resource_name    = COALESCE(${(resource_name ?? null) as string | null}, resource_name),
        base_rate        = COALESCE(${(base_rate ?? null) as number | null}, base_rate),
        total_capacity   = COALESCE(${(total_capacity ?? null) as number | null}, total_capacity),
        current_capacity = COALESCE(${(current_capacity ?? null) as number | null}, current_capacity),
        location_label   = COALESCE(${(location_label ?? null) as string | null}, location_label),
        maintenance_note = COALESCE(${(maintenance_note ?? null) as string | null}, maintenance_note),
        maintenance_due  = COALESCE(${(maintenance_due ?? null) as string | null}::timestamptz, maintenance_due),
        metadata         = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
        updated_at       = NOW()
      WHERE id = ${id} AND user_id = ${req.user!.sub}
      RETURNING *
    `);
    if (!(result.rows ?? []).length) { res.status(404).json(err("NOT_FOUND", "Resource not found", req.trace_id)); return; }
    res.json(ok(result.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "resource update failed");
    res.status(500).json(err("DB_ERROR", "Failed to update resource", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/resources/:id/status  — Update resource status
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/resources/:id/status", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const id     = Number(req.params["id"]);
  const { status } = req.body as { status?: string };
  if (!id || !status) { res.status(400).json(err("VALIDATION_ERROR", "id and status required", req.trace_id)); return; }
  if (!VALID_STATUSES.has(status)) { res.status(400).json(err("VALIDATION_ERROR", `status must be one of: ${[...VALID_STATUSES].join(", ")}`, req.trace_id)); return; }
  try {
    const { db } = await import("@workspace/db");
    const result = await db.execute(sql`
      UPDATE resources SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${req.user!.sub}
      RETURNING id, resource_name, status, updated_at
    `);
    if (!(result.rows ?? []).length) { res.status(404).json(err("NOT_FOUND", "Resource not found", req.trace_id)); return; }
    res.json(ok(result.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "resource status update failed");
    res.status(500).json(err("DB_ERROR", "Failed to update resource status", req.trace_id));
  }
});

export default router;
