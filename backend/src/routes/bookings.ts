import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

const VALID_STATUSES = new Set(["confirmed", "pending", "cancelled", "no_show", "completed"]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/conflict-check  — Check for double-booking before create
// ─────────────────────────────────────────────────────────────────────────────
router.post("/bookings/conflict-check", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const { resource_id, start_time, end_time, exclude_booking_id } = req.body as {
    resource_id?: string; start_time?: string; end_time?: string; exclude_booking_id?: number;
  };
  if (!resource_id || !start_time || !end_time) {
    res.status(400).json(err("VALIDATION_ERROR", "resource_id, start_time, end_time required", req.trace_id));
    return;
  }
  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT id, guest_name, start_time, end_time, status
      FROM bookings
      WHERE resource_id = ${resource_id}
        AND status NOT IN ('cancelled','no_show')
        AND start_time < ${end_time}::timestamptz
        AND end_time   > ${start_time}::timestamptz
        ${exclude_booking_id ? sql`AND id != ${exclude_booking_id}` : sql``}
    `);
    const conflicts = rows.rows ?? [];
    res.json(ok({ has_conflict: conflicts.length > 0, conflicts }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "conflict-check failed");
    res.status(500).json(err("DB_ERROR", "Conflict check failed", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/conflicts/active  — All active double-booking conflicts
// ─────────────────────────────────────────────────────────────────────────────
router.get("/bookings/conflicts/active", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT a.id AS booking_a, b.id AS booking_b,
             a.resource_id, a.resource_name,
             a.start_time, a.end_time,
             a.guest_name AS guest_a, b.guest_name AS guest_b,
             a.industry
      FROM bookings a
      JOIN bookings b ON a.resource_id = b.resource_id
        AND a.id < b.id
        AND a.status NOT IN ('cancelled','no_show')
        AND b.status NOT IN ('cancelled','no_show')
        AND a.start_time < b.end_time
        AND a.end_time   > b.start_time
      WHERE a.user_id = ${req.user!.sub}
      ORDER BY a.start_time DESC
      LIMIT 50
    `);
    res.json(ok({ conflicts: rows.rows ?? [], count: (rows.rows ?? []).length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "active-conflicts fetch failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch conflicts", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings  — Create booking with double-booking guard
// ─────────────────────────────────────────────────────────────────────────────
router.post("/bookings", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const {
    industry, business_subtype, resource_type, resource_id, resource_name,
    start_time, end_time, guest_name, guest_email, guest_phone,
    party_size = 1, amount, currency = "USD", metadata = {}, source = "dashboard",
  } = req.body as Record<string, unknown>;

  if (!industry || !resource_type || !resource_id || !start_time || !end_time) {
    res.status(400).json(err("VALIDATION_ERROR", "industry, resource_type, resource_id, start_time, end_time required", req.trace_id));
    return;
  }

  try {
    const { db } = await import("@workspace/db");

    // Double-booking guard
    const conflicts = await db.execute(sql`
      SELECT id FROM bookings
      WHERE resource_id = ${resource_id as string}
        AND status NOT IN ('cancelled','no_show')
        AND start_time < ${end_time as string}::timestamptz
        AND end_time   > ${start_time as string}::timestamptz
    `);

    if ((conflicts.rows ?? []).length > 0) {
      res.status(409).json({
        ok: false, data: null,
        error: { code: "DOUBLE_BOOKING_CONFLICT", message: "This resource is already booked for the requested time slot.", conflicting_ids: conflicts.rows.map((r: Record<string, unknown>) => r["id"]) },
        trace_id: req.trace_id,
      });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO bookings (
        user_id, industry, business_subtype, resource_type, resource_id, resource_name,
        start_time, end_time, guest_name, guest_email, guest_phone,
        party_size, amount, currency, metadata, source, conflict_checked_at
      ) VALUES (
        ${req.user!.sub}, ${industry as string}, ${(business_subtype ?? null) as string | null},
        ${resource_type as string}, ${resource_id as string}, ${(resource_name ?? null) as string | null},
        ${start_time as string}::timestamptz, ${end_time as string}::timestamptz,
        ${(guest_name ?? null) as string | null}, ${(guest_email ?? null) as string | null},
        ${(guest_phone ?? null) as string | null},
        ${party_size as number}, ${(amount ?? null) as number | null}, ${currency as string},
        ${JSON.stringify(metadata)}::jsonb, ${source as string}, NOW()
      )
      RETURNING *
    `);

    res.status(201).json(ok(result.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "booking create failed");
    res.status(500).json(err("DB_ERROR", "Failed to create booking", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings  — List bookings for user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/bookings", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const status = req.query["status"] as string | undefined;
  const industry = req.query["industry"] as string | undefined;

  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`
      SELECT * FROM bookings
      WHERE user_id = ${req.user!.sub}
        ${status   ? sql`AND status = ${status}` : sql``}
        ${industry ? sql`AND industry = ${industry}` : sql``}
      ORDER BY start_time DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    res.json(ok({ bookings: rows.rows ?? [], limit, offset, count: (rows.rows ?? []).length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "bookings list failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch bookings", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/bookings/:id", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!id) { res.status(400).json(err("VALIDATION_ERROR", "Invalid id", req.trace_id)); return; }
  try {
    const { db } = await import("@workspace/db");
    const rows = await db.execute(sql`SELECT * FROM bookings WHERE id = ${id} AND user_id = ${req.user!.sub}`);
    if (!(rows.rows ?? []).length) { res.status(404).json(err("NOT_FOUND", "Booking not found", req.trace_id)); return; }
    res.json(ok(rows.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "booking fetch failed");
    res.status(500).json(err("DB_ERROR", "Failed to fetch booking", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/status
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/bookings/:id/status", requireAuth, requireSurface("dashboard"), async (req: Request, res: Response) => {
  const id     = Number(req.params["id"]);
  const { status, cancel_reason } = req.body as { status?: string; cancel_reason?: string };
  if (!id || !status) { res.status(400).json(err("VALIDATION_ERROR", "id and status required", req.trace_id)); return; }
  if (!VALID_STATUSES.has(status)) { res.status(400).json(err("VALIDATION_ERROR", `status must be one of: ${[...VALID_STATUSES].join(", ")}`, req.trace_id)); return; }
  try {
    const { db } = await import("@workspace/db");
    const result = await db.execute(sql`
      UPDATE bookings
      SET status = ${status},
          cancelled_at  = ${status === "cancelled" ? sql`NOW()` : sql`cancelled_at`},
          cancel_reason = ${status === "cancelled" ? (cancel_reason ?? null) : sql`cancel_reason`},
          updated_at    = NOW()
      WHERE id = ${id} AND user_id = ${req.user!.sub}
      RETURNING *
    `);
    if (!(result.rows ?? []).length) { res.status(404).json(err("NOT_FOUND", "Booking not found", req.trace_id)); return; }
    res.json(ok(result.rows[0], req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "booking status update failed");
    res.status(500).json(err("DB_ERROR", "Failed to update booking status", req.trace_id));
  }
});

export default router;
