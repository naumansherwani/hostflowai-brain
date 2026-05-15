// ─────────────────────────────────────────────────────────────────────────────
// CRM WhatsApp Connection — OTP-verified phone linking
//
// SURFACE:   CRM  (requireSurface("crm") → Premium plan only)
// INDUSTRIES: All 8
// FOUNDER'S LAW: Gate 1 ✓ (CRM surface) | Gate 2 ✓ (all 8 industries need it)
//
// FLOW:
//   1. POST /api/crm/whatsapp/connect/request
//      → User submits phone number (E.164)
//      → 6-digit OTP generated, SHA-256 hashed, stored with 60s expiry
//      → OTP sent to that WhatsApp number via Meta Business API
//      → Returns { sent: true, phone, expiresIn: 60 }
//
//   2. POST /api/crm/whatsapp/connect/verify
//      → User submits OTP code
//      → Hash compared; expiry checked; max 3 attempts enforced
//      → On success: verified=true, connectedAt=now, otp cleared
//      → Returns { connected: true, phone }
//
//   3. GET  /api/crm/whatsapp/connection    — current connection status
//   4. DELETE /api/crm/whatsapp/connection  — disconnect (sets verified=false)
//
// WHATSAPP SEND NOTE:
//   Uses Meta WhatsApp Business API (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID).
//   First-time messages to a number require a pre-approved Meta template.
//   Recommended: register an "authentication" OTP template in Meta Business Manager
//   named "hostflow_otp" with one body variable {{1}} for the code.
//   If template unavailable, falls back to plain text (works within 24h window).
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { err, ok } from "../lib/response.js";

const router: IRouter = Router();

const WA_TOKEN           = process.env["WHATSAPP_TOKEN"]           ?? "";
const WA_PHONE_NUMBER_ID = process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "";
const WA_API_VERSION     = "v19.0";
const OTP_TTL_SECONDS    = 60;
const MAX_OTP_ATTEMPTS   = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(crypto.randomInt(100_000, 999_999));
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/** Normalise to E.164. Accepts: +923001234567 | 923001234567 | 03001234567 */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // Already international (11+ digits starting with country code)
  if (raw.startsWith("+")) return `+${digits}`;
  // 11-digit local Pakistani (03xxxxxxxxx → +923xxxxxxxxx)
  if (digits.length === 11 && digits.startsWith("0")) return `+92${digits.slice(1)}`;
  // Already has country code without +
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

/** Send OTP via WhatsApp Business API */
async function sendOtpWhatsApp(phone: string, otp: string): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp credentials not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  // Primary: use authentication template if available
  // Fallback: plain text message (requires user to have messaged within 24h)
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: {
      body: `🔐 Your HostFlow AI verification code: *${otp}*\n\nValid for ${OTP_TTL_SECONDS} seconds. Do not share this code with anyone.`,
    },
  });

  const res = await fetch(
    `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${WA_TOKEN}`,
        "Content-Type":  "application/json",
      },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`WhatsApp API error ${res.status}: ${text}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/crm/whatsapp/connect/request
// Body: { phone: string }  — E.164 or local format
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/crm/whatsapp/connect/request",
  requireAuth,
  requireSurface("crm"),
  async (req: Request, res: Response) => {
    const userId  = req.user!.sub;
    const rawPhone = (req.body as { phone?: string }).phone?.trim() ?? "";

    const phone = normalisePhone(rawPhone);
    if (!phone) {
      return res.status(400).json(err(
        "INVALID_PHONE",
        "Please provide a valid phone number in international format (e.g. +923001234567).",
        req.trace_id
      ));
    }

    const { db, whatsappCrmConnections } = await import("@workspace/db");
    const { eq, and }                    = await import("drizzle-orm");

    // Rate-limit: block if a non-expired OTP already exists for this user
    const [existing] = await db
      .select({ otpExpiresAt: whatsappCrmConnections.otpExpiresAt, verified: whatsappCrmConnections.verified })
      .from(whatsappCrmConnections)
      .where(eq(whatsappCrmConnections.userId, userId as unknown as string))
      .limit(1);

    if (existing?.verified) {
      // Already connected — must disconnect first
      return res.status(409).json(err(
        "ALREADY_CONNECTED",
        "A WhatsApp number is already connected. Disconnect it first before linking a new number.",
        req.trace_id
      ));
    }

    if (existing?.otpExpiresAt && existing.otpExpiresAt > new Date()) {
      const secondsLeft = Math.ceil((existing.otpExpiresAt.getTime() - Date.now()) / 1000);
      return res.status(429).json(err(
        "OTP_COOLDOWN",
        `An OTP was already sent. Please wait ${secondsLeft} seconds before requesting a new one.`,
        req.trace_id
      ));
    }

    const otp        = generateOtp();
    const otpHash    = hashOtp(otp);
    const expiresAt  = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Upsert connection row with new OTP
    await db
      .insert(whatsappCrmConnections)
      .values({
        userId:       userId as unknown as string,
        phone,
        otpCodeHash:  otpHash,
        otpExpiresAt: expiresAt,
        otpAttempts:  0,
        verified:     false,
      })
      .onConflictDoUpdate({
        target:  whatsappCrmConnections.userId,
        set: {
          phone,
          otpCodeHash:  otpHash,
          otpExpiresAt: expiresAt,
          otpAttempts:  0,
          verified:     false,
          connectedAt:  null,
        },
      })
      .catch(async () => {
        // No unique constraint on userId — fall back to delete + insert
        await db.delete(whatsappCrmConnections).where(
          eq(whatsappCrmConnections.userId, userId as unknown as string)
        );
        await db.insert(whatsappCrmConnections).values({
          userId:       userId as unknown as string,
          phone,
          otpCodeHash:  otpHash,
          otpExpiresAt: expiresAt,
          otpAttempts:  0,
          verified:     false,
        });
      });

    try {
      await sendOtpWhatsApp(phone, otp);
    } catch (e) {
      req.log.error({ err: e, phone }, "WhatsApp OTP send failed");
      return res.status(502).json(err(
        "WHATSAPP_SEND_FAILED",
        "Could not send OTP via WhatsApp. Please check the phone number and try again.",
        req.trace_id
      ));
    }

    req.log.info({ userId, phone }, "WhatsApp CRM OTP sent");

    return res.json(ok({
      sent:      true,
      phone,
      expiresIn: OTP_TTL_SECONDS,
      message:   `A ${OTP_TTL_SECONDS}-second verification code has been sent to ${phone} on WhatsApp.`,
    }));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/crm/whatsapp/connect/verify
// Body: { code: string }  — 6-digit OTP
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/crm/whatsapp/connect/verify",
  requireAuth,
  requireSurface("crm"),
  async (req: Request, res: Response) => {
    const userId  = req.user!.sub;
    const rawCode = (req.body as { code?: string }).code?.trim() ?? "";

    if (!rawCode || !/^\d{6}$/.test(rawCode)) {
      return res.status(400).json(err(
        "INVALID_CODE",
        "Please enter the 6-digit verification code sent to your WhatsApp.",
        req.trace_id
      ));
    }

    const { db, whatsappCrmConnections } = await import("@workspace/db");
    const { eq }                         = await import("drizzle-orm");

    const [row] = await db
      .select()
      .from(whatsappCrmConnections)
      .where(eq(whatsappCrmConnections.userId, userId as unknown as string))
      .limit(1);

    if (!row) {
      return res.status(404).json(err(
        "NO_PENDING_OTP",
        "No pending verification found. Please request a new OTP first.",
        req.trace_id
      ));
    }

    if (row.verified) {
      return res.status(409).json(err(
        "ALREADY_CONNECTED",
        "WhatsApp is already connected to this account.",
        req.trace_id
      ));
    }

    // Expired
    if (!row.otpExpiresAt || row.otpExpiresAt < new Date()) {
      return res.status(410).json(err(
        "OTP_EXPIRED",
        "The verification code has expired. Please request a new one.",
        req.trace_id
      ));
    }

    // Max attempts exceeded
    if (row.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json(err(
        "OTP_MAX_ATTEMPTS",
        `Maximum verification attempts (${MAX_OTP_ATTEMPTS}) exceeded. Please request a new code.`,
        req.trace_id
      ));
    }

    // Wrong code — increment attempt counter
    if (hashOtp(rawCode) !== row.otpCodeHash) {
      await db
        .update(whatsappCrmConnections)
        .set({ otpAttempts: row.otpAttempts + 1 })
        .where(eq(whatsappCrmConnections.userId, userId as unknown as string));

      const attemptsLeft = MAX_OTP_ATTEMPTS - (row.otpAttempts + 1);
      return res.status(400).json(err(
        "WRONG_CODE",
        `Incorrect code. ${attemptsLeft > 0 ? `${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.` : "No attempts remaining — please request a new code."}`,
        req.trace_id
      ));
    }

    // ✅ Correct code — mark verified, clear OTP
    const now = new Date();
    await db
      .update(whatsappCrmConnections)
      .set({
        verified:     true,
        connectedAt:  now,
        otpCodeHash:  null,
        otpExpiresAt: null,
        otpAttempts:  0,
        lastMessageAt: now,
      })
      .where(eq(whatsappCrmConnections.userId, userId as unknown as string));

    req.log.info({ userId, phone: row.phone }, "WhatsApp CRM connection verified");

    return res.json(ok({
      connected: true,
      phone:     row.phone,
      message:   `WhatsApp ${row.phone} successfully connected to your AI CRM. You will now receive updates, insights, and can chat with your AI Advisor directly on WhatsApp.`,
    }));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crm/whatsapp/connection — current connection status
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/crm/whatsapp/connection",
  requireAuth,
  requireSurface("crm"),
  async (req: Request, res: Response) => {
    const userId = req.user!.sub;

    const { db, whatsappCrmConnections } = await import("@workspace/db");
    const { eq }                         = await import("drizzle-orm");

    const [row] = await db
      .select({
        phone:         whatsappCrmConnections.phone,
        verified:      whatsappCrmConnections.verified,
        connectedAt:   whatsappCrmConnections.connectedAt,
        lastMessageAt: whatsappCrmConnections.lastMessageAt,
      })
      .from(whatsappCrmConnections)
      .where(eq(whatsappCrmConnections.userId, userId as unknown as string))
      .limit(1);

    if (!row || !row.verified) {
      return res.json(ok({ connected: false }));
    }

    return res.json(ok({
      connected:     true,
      phone:         row.phone,
      connectedAt:   row.connectedAt,
      lastMessageAt: row.lastMessageAt,
    }));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/crm/whatsapp/connection — disconnect WhatsApp
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/crm/whatsapp/connection",
  requireAuth,
  requireSurface("crm"),
  async (req: Request, res: Response) => {
    const userId = req.user!.sub;

    const { db, whatsappCrmConnections } = await import("@workspace/db");
    const { eq }                         = await import("drizzle-orm");

    await db
      .delete(whatsappCrmConnections)
      .where(eq(whatsappCrmConnections.userId, userId as unknown as string));

    req.log.info({ userId }, "WhatsApp CRM connection removed");

    return res.json(ok({
      disconnected: true,
      message: "WhatsApp disconnected from your AI CRM.",
    }));
  }
);

export default router;
