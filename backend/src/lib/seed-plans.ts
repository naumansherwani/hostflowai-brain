// ─────────────────────────────────────────────────────────────────────────────
// Plan Feature Limits seed — runs on server startup (upsert — safe to repeat)
// Plans: trial | basic | pro | premium | enterprise
// Internal AI agents = UNLIMITED. These caps are USER-FACING only.
//
// Confirmed from Lovable pricing page (May 2026):
//   Trial (3-day free): 5/day, 5/hr, no pricing, no voice
//   Basic  (£22/mo):  50/day, 30/hr, 100 CRM, 50 bookings/mo, no pricing, no voice
//   Pro    (£44/mo): 200/day, 80/hr, unlimited CRM/bookings, AI pricing, AI follow-ups, no voice
//   Premium (£86/mo): unlimited, AI voice 500min, demand forecast, custom AI training
//   Enterprise: custom — handled outside this seed
// ─────────────────────────────────────────────────────────────────────────────
import { sql } from "drizzle-orm";

export async function seedPlanLimits(): Promise<void> {
  try {
    const { db } = await import("@workspace/db");

    await db.execute(sql`
      INSERT INTO plan_feature_limits (
        plan,
        ai_daily_messages, ai_hourly_fair_use, ai_pricing_uses, ai_followups,
        ai_calendar_monthly, ai_voice_minutes,
        ai_demand_forecasting, ai_conflict_resolution, ai_custom_training,
        crm_contacts, bookings_monthly, industries,
        deal_pipeline, white_label_multi_team
      ) VALUES
        -- trial (3-day free)
        ('trial',     5,   5,   0,  10, 50,   0, false, false, false, 150,  -1,  1, false, false),
        -- basic (£22/mo) — 1 industry, 100 CRM, 50 bookings, no AI pricing, no voice
        ('basic',    50,  30,   0,   0, 50,   0, false, false, false, 100,  50,  1, false, false),
        -- pro (£44/mo) — unlimited CRM/bookings, AI pricing, AI follow-ups, no voice
        ('pro',     200,  80, 500, 300, -1,   0, false, false, false,  -1,  -1,  1,  true, false),
        -- premium (£86/mo) — unlimited AI, AI voice, demand forecast, custom training
        ('premium',  -1, 200,  -1,  -1, -1, 500,  true,  true,  true,  -1,  -1,  1,  true, false)
      ON CONFLICT (plan) DO UPDATE SET
        ai_daily_messages      = EXCLUDED.ai_daily_messages,
        ai_hourly_fair_use     = EXCLUDED.ai_hourly_fair_use,
        ai_pricing_uses        = EXCLUDED.ai_pricing_uses,
        ai_followups           = EXCLUDED.ai_followups,
        ai_calendar_monthly    = EXCLUDED.ai_calendar_monthly,
        ai_voice_minutes       = EXCLUDED.ai_voice_minutes,
        ai_demand_forecasting  = EXCLUDED.ai_demand_forecasting,
        ai_conflict_resolution = EXCLUDED.ai_conflict_resolution,
        ai_custom_training     = EXCLUDED.ai_custom_training,
        crm_contacts           = EXCLUDED.crm_contacts,
        bookings_monthly       = EXCLUDED.bookings_monthly,
        industries             = EXCLUDED.industries,
        deal_pipeline          = EXCLUDED.deal_pipeline,
        white_label_multi_team = EXCLUDED.white_label_multi_team,
        updated_at             = now()
    `);

    // Clean up old 'standard' row (renamed to 'pro')
    await db.execute(sql`DELETE FROM plan_feature_limits WHERE plan = 'standard'`);
  } catch {
    // Non-fatal — server still starts even if seed fails
  }
}
