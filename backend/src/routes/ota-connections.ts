// ─────────────────────────────────────────────────────────────────────────────
// HostFlow AI — OTA Connections Route
// Users save their OTA property IDs here → Aria gets full channel context
//
// Endpoints:
//   GET    /api/profile/ota-connections/channels   — list all supported channels (public)
//   GET    /api/profile/ota-connections             — fetch user's connected OTAs
//   POST   /api/profile/ota-connections             — save / update OTA connection
//   DELETE /api/profile/ota-connections/:channel   — remove a channel connection
//
// Phase 1 (now):  Advisory intelligence — Aria uses property IDs for context.
// Phase 2 (soon): Live booking data sync via Channel Manager API per platform.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

// Supported OTA channels with metadata
const OTA_CHANNELS = {
  booking_com:    { name: "Booking.com",         commission_pct: 17, regions: ["global"] },
  airbnb:         { name: "Airbnb",              commission_pct: 17, regions: ["global"] },
  vrbo:           { name: "VRBO",                commission_pct:  6, regions: ["us", "uk", "eu"] },
  expedia:        { name: "Expedia",             commission_pct: 20, regions: ["global"] },
  agoda:          { name: "Agoda",               commission_pct: 18, regions: ["apac", "gulf", "mena"] },
  direct_website: { name: "Direct Website",      commission_pct:  0, regions: ["global"] },
  whatsapp:       { name: "WhatsApp Bookings",   commission_pct:  0, regions: ["global"] },
  ai_crm:         { name: "AI CRM Reservations", commission_pct:  0, regions: ["global"] },
} as const satisfies Record<string, { name: string; commission_pct: number; regions: string[] }>;

type OtaChannel = keyof typeof OTA_CHANNELS;

function isValidChannel(ch: string): ch is OtaChannel {
  return ch in OTA_CHANNELS;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/ota-connections/channels
// Public: list all supported OTA channels (no auth needed — used by Lovable UI)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/profile/ota-connections/channels", (_req, res) => {
  const channels = Object.entries(OTA_CHANNELS).map(([slug, meta]) => ({
    channel:        slug,
    name:           meta.name,
    commission_pct: meta.commission_pct,
    regions:        meta.regions,
    phase:          slug === "whatsapp" || slug === "ai_crm" || slug === "direct_website"
                      ? "live" : "advisory",
  }));
  res.json(ok({ channels }, "ota-channels"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/ota-connections
// Returns all OTA channels + which ones this user has connected
// ─────────────────────────────────────────────────────────────────────────────
router.get("/profile/ota-connections", requireAuth, async (req, res) => {
  const userId = req.user!.sub;

  const userConnections: Record<string, unknown> = {};
  try {
    const { db, otaConnections } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(otaConnections)
      .where(eq(otaConnections.userId, userId));

    for (const row of rows) {
      userConnections[row.channel] = row;
    }
  } catch {
    req.log.warn({ userId }, "ota_connections unavailable — returning empty");
  }

  const channels = Object.entries(OTA_CHANNELS).map(([slug, meta]) => ({
    channel:        slug,
    name:           meta.name,
    commission_pct: meta.commission_pct,
    regions:        meta.regions,
    connected:      slug in userConnections,
    connection:     userConnections[slug] ?? null,
    phase:          slug === "whatsapp" || slug === "ai_crm" || slug === "direct_website"
                      ? "live" : "advisory",
  }));

  res.json(ok({
    channels,
    total_channels:  channels.length,
    connected_count: channels.filter(c => c.connected).length,
    advisory_note:
      "Phase 1: Aria uses your OTA property IDs for advisory intelligence context. " +
      "Phase 2 (coming soon): live booking data sync via Channel Manager API.",
  }, req.trace_id));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/profile/ota-connections
// Body: { channel, property_id, property_name?, notes? }
// Save / update one OTA channel connection for this user
// ─────────────────────────────────────────────────────────────────────────────
router.post("/profile/ota-connections", requireAuth, async (req, res) => {
  const userId = req.user!.sub;
  const { channel, property_id, property_name, notes } = req.body as {
    channel:        string;
    property_id:    string;
    property_name?: string;
    notes?:         string;
  };

  if (!channel || !property_id) {
    res.status(400).json(err("VALIDATION_ERROR", "channel and property_id are required", req.trace_id));
    return;
  }

  if (!isValidChannel(channel)) {
    res.status(400).json(err(
      "INVALID_CHANNEL",
      `Unsupported channel '${channel}'. Valid: ${Object.keys(OTA_CHANNELS).join(", ")}`,
      req.trace_id,
    ));
    return;
  }

  const channelMeta = OTA_CHANNELS[channel];

  try {
    const { db, otaConnections } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db
      .insert(otaConnections)
      .values({
        userId,
        channel,
        propertyId:   property_id,
        propertyName: property_name ?? null,
        notes:        notes ?? null,
      })
      .onConflictDoUpdate({
        target: [otaConnections.userId, otaConnections.channel],
        set: {
          propertyId:   property_id,
          propertyName: property_name ?? null,
          notes:        notes ?? null,
          updatedAt:    sql`NOW()`,
        },
      });
  } catch (e) {
    req.log.error({ err: e, userId, channel }, "OTA connection upsert failed");
    res.status(500).json(err("DB_ERROR", "Failed to save OTA connection", req.trace_id));
    return;
  }

  req.log.info({ userId, channel, property_id }, "OTA connection saved");

  res.json(ok({
    channel,
    name:           channelMeta.name,
    property_id,
    property_name:  property_name ?? null,
    commission_pct: channelMeta.commission_pct,
    connected:      true,
    message:
      `${channelMeta.name} connected. Aria now has full channel context and will apply ` +
      `${channelMeta.name} strategy intelligence for your business.`,
  }, req.trace_id));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/profile/ota-connections/:channel
// Remove a channel connection
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/profile/ota-connections/:channel", requireAuth, async (req, res) => {
  const userId  = req.user!.sub;
  const channel = req.params["channel"] as string;

  if (!isValidChannel(channel)) {
    res.status(400).json(err("INVALID_CHANNEL", `Unknown channel '${channel}'`, req.trace_id));
    return;
  }

  try {
    const { db, otaConnections } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    await db
      .delete(otaConnections)
      .where(and(
        eq(otaConnections.userId,  userId),
        eq(otaConnections.channel, channel),
      ));
  } catch (e) {
    req.log.error({ err: e, userId, channel }, "OTA connection delete failed");
    res.status(500).json(err("DB_ERROR", "Failed to remove OTA connection", req.trace_id));
    return;
  }

  const channelMeta = OTA_CHANNELS[channel];
  req.log.info({ userId, channel }, "OTA connection removed");

  res.json(ok({
    channel,
    name:    channelMeta.name,
    removed: true,
    message: `${channelMeta.name} disconnected. You can reconnect at any time.`,
  }, req.trace_id));
});

export default router;
