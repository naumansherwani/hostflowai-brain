// ─────────────────────────────────────────────────────────────────────────────
// Industry Isolation Middleware — Spec §8.3 (MOST IMPORTANT)
//
// Purpose: Read profiles.industry + profiles.business_subtype from our DB
//   on EVERY industry-gated request, then enforce:
//   - 403 INDUSTRY_MISMATCH if requested industry ≠ user's profile industry
//   - 403 SUBTYPE_MISMATCH for hospitality sub-type violations
//
// Profile source: user_profiles table (local mirror of Lovable's Supabase profiles,
//   kept in sync via POST /api/profile/sync called by Lovable on every profile change).
//
// ─── HOSPITALITY SUB-TYPE RULES ────────────────────────────────────────────────
//   hotel_property → only rooms/occupancy/RevPAR/gap-night data
//   travel_tours   → only tour packages/travelers/itineraries
//   NEVER blend — backend MUST filter at query level. Frontend hide is NOT enough.
//
// ─── FAIL-OPEN POLICY ──────────────────────────────────────────────────────────
//   If user has NO profile yet (new user, not yet synced) → ALLOW but warn in log.
//   Rationale: blocking new users until sync completes is worse UX than a brief window.
//   This window closes as soon as Lovable calls /api/profile/sync post-onboarding.
//
// ─── HOW TO USE ────────────────────────────────────────────────────────────────
//   import { requireIndustryMatch } from "../middleware/require-industry-match.js";
//
//   // Auto-detect industry from :industry param OR body.industry
//   router.post("/advisor/:industry", requireAuth, requireIndustryMatch(), ...)
//
//   // Check a specific industry (no param)
//   router.post("/pricing/suggest", requireAuth, requireIndustryMatch({ checkBody: true }), ...)
//
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
import { err } from "../lib/response.js";

// Canonical industry slug normalization (mirrors industry-advisor-prompts.ts)
const INDUSTRY_ALIASES: Record<string, string> = {
  tourism_hospitality: "hospitality",
  hotel:               "hospitality",
  travel:              "hospitality",
  tour:                "hospitality",
  tour_operator:       "hospitality",
  aviation:            "airlines",
  airline:             "airlines",
  fleet:               "car_rental",
  rental:              "car_rental",
  clinic:              "healthcare",
  medical:             "healthcare",
  school:              "education",
  university:          "education",
  training:            "education",
  supply_chain:        "logistics",
  freight:             "logistics",
  shipping:            "logistics",
  event:               "events_entertainment",
  entertainment:       "events_entertainment",
  railway:             "railways",
  rail:                "railways",
};

function normalizeSlug(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/[^a-z_]/g, "");
  return INDUSTRY_ALIASES[lower] ?? lower;
}

// Industries that have a pricing feature (3 non-pricing → 403 on /pricing/suggest)
const NON_PRICING_INDUSTRIES = new Set(["healthcare", "education", "logistics"]);

// The interface is declared in the global Express namespace in jwt.ts
// We extend it here for userProfile
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userProfile?: {
        userId:          string;
        industry:        string;
        businessSubtype: string | null;
        plan:            string;
        onboardingComplete: boolean;
      };
    }
  }
}

export interface IndustryMatchOptions {
  // If true, also read industry from req.body.industry (for non-parameterized routes)
  checkBody?: boolean;
  // If set, gate this specific feature (e.g. "pricing") and 403 non-pricing industries
  featureGate?: "pricing";
  // If true, a missing profile does NOT fail-open — returns 403 (for high-security routes)
  strictProfileRequired?: boolean;
}

export function requireIndustryMatch(options: IndustryMatchOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) { next(); return; } // requireAuth runs before this — won't hit in practice

    const userId = user.sub;

    try {
      const { db, userProfiles } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");

      // ── Load profile from DB ──────────────────────────────────────────────
      const [profile] = await db
        .select({
          userId:             userProfiles.userId,
          industry:           userProfiles.industry,
          businessSubtype:    userProfiles.businessSubtype,
          plan:               userProfiles.plan,
          onboardingComplete: userProfiles.onboardingComplete,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId as unknown as string))
        .limit(1);

      if (!profile) {
        if (options.strictProfileRequired) {
          res.status(403).json(err(
            "PROFILE_NOT_SYNCED",
            "Your industry profile has not been set up yet. Please complete onboarding in the app.",
            req.trace_id
          ));
          return;
        }
        // Fail-open: new user, profile not synced yet — allow with warning
        req.log?.warn({ userId }, "No user_profile found — industry isolation bypassed (fail-open)");
        next();
        return;
      }

      // Attach profile to req for downstream handlers
      req.userProfile = {
        userId:          profile.userId,
        industry:        profile.industry,
        businessSubtype: profile.businessSubtype,
        plan:            profile.plan,
        onboardingComplete: profile.onboardingComplete,
      };

      const userIndustry = normalizeSlug(profile.industry);

      // ── Feature gate check (pricing) ──────────────────────────────────────
      if (options.featureGate === "pricing" && NON_PRICING_INDUSTRIES.has(userIndustry)) {
        res.status(403).json(err(
          "PRICING_NOT_AVAILABLE",
          `AI Smart Pricing is not available for the ${profile.industry} industry. Available for: hospitality, airlines, car_rental, events_entertainment, railways.`,
          req.trace_id
        ));
        return;
      }

      // ── Industry param check ──────────────────────────────────────────────
      const paramIndustry  = req.params["industry"] as string | undefined;
      const bodyIndustry   = options.checkBody ? (req.body?.industry as string | undefined) : undefined;
      const requestedRaw   = paramIndustry ?? bodyIndustry;

      if (requestedRaw) {
        const requestedIndustry = normalizeSlug(requestedRaw);

        if (requestedIndustry !== userIndustry) {
          res.status(403).json(err(
            "INDUSTRY_MISMATCH",
            `Requested industry '${requestedIndustry}' does not match your account industry '${userIndustry}'. Access denied.`,
            req.trace_id
          ));
          return;
        }
      }

      // ── Hospitality sub-type check ────────────────────────────────────────
      if (userIndustry === "hospitality") {
        const bodySubtype  = req.body?.business_subtype as string | undefined;
        const paramSubtype = req.params["subtype"] as string | undefined;
        const requestedSubtype = bodySubtype ?? paramSubtype;

        if (requestedSubtype && profile.businessSubtype &&
            requestedSubtype !== profile.businessSubtype) {
          res.status(403).json(err(
            "SUBTYPE_MISMATCH",
            `Requested sub-type '${requestedSubtype}' does not match your account sub-type '${profile.businessSubtype}'. hotel_property and travel_tours data are strictly isolated.`,
            req.trace_id
          ));
          return;
        }

        // Inject the authoritative subtype into the request body so downstream
        // handlers always use the DB-verified value, never the client-supplied one.
        if (profile.businessSubtype) {
          req.body = req.body ?? {};
          req.body.business_subtype = profile.businessSubtype;
        }
      }

      next();
    } catch (e) {
      // Fail-open on DB errors — never block users due to middleware failure
      req.log?.warn({ err: e, userId }, "requireIndustryMatch DB error — failing open");
      next();
    }
  };
}
