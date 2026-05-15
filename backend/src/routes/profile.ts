// ─────────────────────────────────────────────────────────────────────────────
// Profile Sync — Server-side industry + business_subtype store (§8.3)
//
// POST /api/profile/sync  — Lovable calls this after onboarding / profile update.
//   Upserts user_profiles row with industry + business_subtype from the request.
//   This is what enables requireIndustryMatch middleware to read industry
//   server-side on every subsequent request.
//
// GET  /api/profile/me    — Returns the current server-side profile record.
//   Lovable can call this to verify sync status.
//
// PATCH /api/profile/me   — Partial update (plan, onboarding status, etc.)
//   Used by payment webhooks (Polar) to keep plan denormalized here.
//
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";

const router: IRouter = Router();

// ── Valid values ──────────────────────────────────────────────────────────────
const VALID_INDUSTRIES = new Set([
  "hospitality", "airlines", "car_rental", "healthcare",
  "education", "logistics", "events_entertainment", "railways",
]);
const VALID_SUBTYPES   = new Set(["hotel_property", "travel_tours"]);
const VALID_PLANS      = new Set(["trial", "basic", "pro", "premium"]);

// Legacy alias normalizer
function normalizeIndustry(raw: string): string {
  const map: Record<string, string> = {
    tourism_hospitality: "hospitality",
    hotel:               "hospitality",
    aviation:            "airlines",
    airline:             "airlines",
    fleet:               "car_rental",
    rental:              "car_rental",
    clinic:              "healthcare",
    medical:             "healthcare",
    school:              "education",
    university:          "education",
    freight:             "logistics",
    shipping:            "logistics",
    event:               "events_entertainment",
    entertainment:       "events_entertainment",
    railway:             "railways",
    rail:                "railways",
  };
  return map[raw.toLowerCase()] ?? raw.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/profile/sync
// Called by Lovable after user completes onboarding or updates their profile.
// Body: { industry, business_subtype?, display_name?, business_name?, email?,
//         phone?, country?, timezone?, plan?, onboarding_complete? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/profile/sync", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const body   = req.body as {
    industry?:            string;
    business_subtype?:    string;
    display_name?:        string;
    business_name?:       string;
    email?:               string;
    phone?:               string;
    country?:             string;
    timezone?:            string;
    plan?:                string;
    onboarding_complete?: boolean;
  };

  if (!body.industry) {
    res.status(400).json(err("VALIDATION_ERROR", "industry is required", req.trace_id));
    return;
  }

  const industry = normalizeIndustry(body.industry);

  if (!VALID_INDUSTRIES.has(industry)) {
    res.status(400).json(err("VALIDATION_ERROR",
      `Invalid industry '${body.industry}'. Valid: ${[...VALID_INDUSTRIES].join(", ")}`,
      req.trace_id));
    return;
  }

  // business_subtype is ONLY valid for hospitality
  const subtype = body.business_subtype ?? null;
  if (subtype && industry !== "hospitality") {
    res.status(400).json(err("VALIDATION_ERROR",
      "business_subtype is only valid for the 'hospitality' industry",
      req.trace_id));
    return;
  }
  if (industry === "hospitality" && subtype && !VALID_SUBTYPES.has(subtype)) {
    res.status(400).json(err("VALIDATION_ERROR",
      `Invalid business_subtype '${subtype}'. Valid: hotel_property, travel_tours`,
      req.trace_id));
    return;
  }

  // Normalize plan slug (guard against 'standard' legacy)
  let plan = body.plan ?? "trial";
  if (plan === "standard") plan = "pro";
  if (!VALID_PLANS.has(plan)) plan = "trial";

  try {
    const { db } = await import("@workspace/db");
    const { userProfiles } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");

    // Upsert — update if exists, insert if new
    await db.execute(sql`
      INSERT INTO user_profiles (
        user_id, industry, business_subtype, display_name, business_name,
        email, phone, country, timezone, plan, onboarding_complete,
        synced_at, created_at, updated_at
      ) VALUES (
        ${userId},
        ${industry},
        ${subtype},
        ${body.display_name  ?? null},
        ${body.business_name ?? null},
        ${body.email         ?? null},
        ${body.phone         ?? null},
        ${body.country       ?? null},
        ${body.timezone      ?? "UTC"},
        ${plan},
        ${body.onboarding_complete ?? false},
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        industry           = EXCLUDED.industry,
        business_subtype   = EXCLUDED.business_subtype,
        display_name       = COALESCE(EXCLUDED.display_name,  user_profiles.display_name),
        business_name      = COALESCE(EXCLUDED.business_name, user_profiles.business_name),
        email              = COALESCE(EXCLUDED.email,         user_profiles.email),
        phone              = COALESCE(EXCLUDED.phone,         user_profiles.phone),
        country            = COALESCE(EXCLUDED.country,       user_profiles.country),
        timezone           = COALESCE(EXCLUDED.timezone,      user_profiles.timezone),
        plan               = EXCLUDED.plan,
        onboarding_complete = EXCLUDED.onboarding_complete,
        synced_at          = NOW(),
        updated_at         = NOW()
    `);

    // Read back the upserted record to return to caller
    const { eq } = await import("drizzle-orm");
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId as unknown as string))
      .limit(1);

    req.log.info({ userId, industry, subtype, plan }, "Profile synced");
    res.status(200).json(ok({ profile, synced: true }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Profile sync failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to sync profile", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/me
// Returns current server-side profile record.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/profile/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  try {
    const { db, userProfiles } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId as unknown as string))
      .limit(1);

    if (!profile) {
      res.status(404).json(err("NOT_FOUND",
        "Profile not found. Call POST /api/profile/sync to initialize.",
        req.trace_id));
      return;
    }

    res.json(ok({ profile }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Get profile failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch profile", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/profile/me
// Partial update — used by Polar webhooks to keep plan in sync, etc.
// Body: { plan?, onboarding_complete?, display_name?, business_name?, timezone? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/profile/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const body   = req.body as {
    plan?:                string;
    onboarding_complete?: boolean;
    display_name?:        string;
    business_name?:       string;
    timezone?:            string;
  };

  try {
    const { db, userProfiles } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [existing] = await db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId as unknown as string))
      .limit(1);

    if (!existing) {
      res.status(404).json(err("NOT_FOUND",
        "Profile not found. Call POST /api/profile/sync to initialize.",
        req.trace_id));
      return;
    }

    let plan = body.plan;
    if (plan === "standard") plan = "pro";
    if (plan && !VALID_PLANS.has(plan)) {
      res.status(400).json(err("VALIDATION_ERROR",
        `Invalid plan '${plan}'. Valid: trial, basic, pro, premium`,
        req.trace_id));
      return;
    }

    const [updated] = await db
      .update(userProfiles)
      .set({
        updatedAt:  new Date(),
        syncedAt:   new Date(),
        ...(plan               !== undefined && { plan }),
        ...(body.onboarding_complete !== undefined && { onboardingComplete: body.onboarding_complete }),
        ...(body.display_name  !== undefined && { displayName:   body.display_name }),
        ...(body.business_name !== undefined && { businessName:  body.business_name }),
        ...(body.timezone      !== undefined && { timezone:      body.timezone }),
      })
      .where(eq(userProfiles.userId, userId as unknown as string))
      .returning();

    res.json(ok({ profile: updated }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Patch profile failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to update profile", req.trace_id));
  }
});

export default router;
