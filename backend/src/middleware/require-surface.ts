// ─────────────────────────────────────────────────────────────────────────────
// HostFlow AI — Surface Isolation Middleware  (Spec §5 — NON-NEGOTIABLE)
//
// PURPOSE
//   Enforce strict separation between the two UI surfaces:
//
//   dashboard  → Business Operations & Intelligence
//                Accessible to ALL plans (Trial / Basic / Pro / Premium).
//                Features: AI Advisor chat, Bookings, Resources, AI Smart Pricing,
//                           AI Calendar, Health Scores, Benchmarks, Onboarding.
//
//   crm        → AI CRM — Customer Relationships & Revenue Growth
//                PREMIUM PLAN ONLY. 403 CRM_PREMIUM_ONLY for all other plans.
//                Features: Contacts, Tickets, Deals, AI Follow-ups, Predictive Revenue,
//                           Competitor Intel, Smart Meeting Scheduler, Voice Assistant.
//
// ─── INDUSTRY ISOLATION STILL APPLIES ──────────────────────────────────────
//   Surface isolation does NOT replace industry isolation — both apply.
//   requireIndustryMatch runs alongside requireSurface.
//   RULE: industry gate first, then plan gate, then feature gate.
//
// ─── HOW LOVABLE USES THIS ──────────────────────────────────────────────────
//   Lovable MUST send header on EVERY authenticated API call:
//     X-HostFlow-Surface: dashboard        ← from Dashboard pages
//     X-HostFlow-Surface: crm             ← from AI CRM pages
//
// ─── FAIL-OPEN POLICY ───────────────────────────────────────────────────────
//   If header is missing → warn in log and allow (backwards compat).
//   This grace window closes once Lovable integrates the header on all calls.
//   Intentional: never block users due to a missing header.
//
// ─── MIDDLEWARE CHAIN ORDER ─────────────────────────────────────────────────
//   requireAuth
//     → requireSurface("dashboard" | "crm")   ← surface + plan gate
//     → requireIndustryMatch(...)              ← industry + subtype gate
//     → checkAiLimit(...)                      ← per-plan feature limit
//     → handler
//
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
import { err } from "../lib/response.js";

export type HostFlowSurface = "dashboard" | "crm";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      surface?: HostFlowSurface;
    }
  }
}

export function requireSurface(allowedSurface: HostFlowSurface) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.sub;
    if (!userId) { next(); return; } // requireAuth always runs before this

    const raw = req.headers["x-hostflow-surface"] as string | undefined;
    const incomingSurface = raw?.toLowerCase() as HostFlowSurface | undefined;

    // ── No header → fail-open ─────────────────────────────────────────────────
    if (!incomingSurface) {
      req.log?.warn(
        { path: req.path, expectedSurface: allowedSurface },
        "X-HostFlow-Surface header missing — surface check bypassed (fail-open). Lovable must add this header."
      );
      req.surface = allowedSurface; // assume correct surface so downstream can use it
      next();
      return;
    }

    // ── Surface mismatch → hard 403 ───────────────────────────────────────────
    if (incomingSurface !== allowedSurface) {
      res.status(403).json(err(
        "SURFACE_MISMATCH",
        `This endpoint belongs to the '${allowedSurface}' surface. ` +
        `Request arrived with X-HostFlow-Surface: '${incomingSurface}'. Access denied.`,
        req.trace_id
      ));
      return;
    }

    // ── CRM surface → Premium plan only ───────────────────────────────────────
    if (allowedSurface === "crm") {
      try {
        // Use profile already loaded by requireIndustryMatch if available
        let plan: string | null | undefined = req.userProfile?.plan;

        if (!plan) {
          // Self-contained: load plan from DB without requireIndustryMatch dependency
          const { db, userProfiles } = await import("@workspace/db");
          const { eq }              = await import("drizzle-orm");
          const [row] = await db
            .select({ plan: userProfiles.plan })
            .from(userProfiles)
            .where(eq(userProfiles.userId, userId as unknown as string))
            .limit(1);
          plan = row?.plan;
        }

        // Only gate if we actually know the plan — fail-open if profile not synced yet
        if (plan && plan !== "premium") {
          res.status(403).json(err(
            "CRM_PREMIUM_ONLY",
            `AI CRM requires the Premium plan (£108/mo). Your current plan: '${plan}'. ` +
            `Upgrade at https://www.hostflowai.net.`,
            req.trace_id
          ));
          return;
        }
      } catch (e) {
        // DB error → fail-open, never block user due to middleware failure
        req.log?.warn({ err: e, userId }, "requireSurface CRM plan check DB error — failing open");
      }
    }

    // Attach surface to request for downstream handlers and audit logs
    req.surface = allowedSurface;
    next();
  };
}
