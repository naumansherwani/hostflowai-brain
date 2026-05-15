import { pgTable, bigserial, text, integer, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Profiles — AI 5-Minute Setup
// Advisor asks 5 targeted questions on first session.
// Answers feed customer_360_profiles and unlock personalized dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export const onboardingProfiles = pgTable(
  "onboarding_profiles",
  {
    id:               bigserial("id", { mode: "number" }).primaryKey(),
    userId:           text("user_id").notNull(),
    industry:         text("industry").notNull(),

    // Onboarding state
    step:             integer("step").notNull().default(0),
    // 0 = not started, 1-5 = question number, 6 = complete
    isComplete:       boolean("is_complete").notNull().default(false),

    // Collected answers (keyed by question slug)
    answers:          jsonb("answers").notNull().default({}),
    // {
    //   "business_size": "12 rooms",
    //   "biggest_pain": "double bookings",
    //   "channels": ["Booking.com", "Airbnb"],
    //   "monthly_revenue_range": "£10k-£30k",
    //   "primary_goal": "increase occupancy"
    // }

    // AI-extracted profile summary from answers
    profileSummary:   text("profile_summary"),
    // Written by advisor after step 5: "You manage a 12-room property..."

    // KPIs unlocked by onboarding answers (industry-specific)
    unlockedKpis:     jsonb("unlocked_kpis").notNull().default([]),
    // ["occupancy_pct", "adr", "revpar"] for hotel

    completedAt:      timestamp("completed_at",   { withTimezone: true }),
    createdAt:        timestamp("created_at",     { withTimezone: true }).notNull().defaultNow(),
    updatedAt:        timestamp("updated_at",     { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("op_user_industry_idx").on(t.userId, t.industry),
  ]
);

export const insertOnboardingProfileSchema = createInsertSchema(onboardingProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OnboardingProfile       = typeof onboardingProfiles.$inferSelect;
export type InsertOnboardingProfile = z.infer<typeof insertOnboardingProfileSchema>;
