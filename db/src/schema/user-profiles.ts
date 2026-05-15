import {
  pgTable, text, timestamp, boolean, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// user_profiles — Server-side source of truth for industry + business_subtype.
//
// Populated by POST /api/profile/sync (called by Lovable after onboarding/update).
// Read server-side on EVERY industry-gated request via requireIndustryMatch middleware.
//
// WHY a separate table: Lovable's Supabase (Project A) holds the canonical
// profiles table, but querying an external DB on every request adds latency.
// This table is a fast local mirror, updated via sync calls from Lovable.
//
// Per spec §8.3:
//   - hospitality + business_subtype='hotel_property' → rooms/occupancy only
//   - hospitality + business_subtype='travel_tours'   → tour packages only
//   - NEVER blend sub-types; backend MUST filter at query level
// ─────────────────────────────────────────────────────────────────────────────
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId:          text("user_id").primaryKey(),

    // ── Industry & sub-type (§8.3 isolation) ─────────────────────────────────
    industry:        text("industry").notNull(),
    // Hospitality only: 'hotel_property' | 'travel_tours'
    // All other industries: null
    businessSubtype: text("business_subtype"),

    // ── Identity ─────────────────────────────────────────────────────────────
    displayName:     text("display_name"),
    businessName:    text("business_name"),
    email:           text("email"),
    phone:           text("phone"),
    country:         text("country"),
    timezone:        text("timezone").default("UTC"),

    // ── Plan (denormalized for fast middleware reads) ──────────────────────────
    // Source of truth is subscriptions.plan — this is a read-through cache.
    // Updated on every sync + on Polar webhook.
    plan:            text("plan").notNull().default("trial"),

    // ── Onboarding ────────────────────────────────────────────────────────────
    onboardingComplete: boolean("onboarding_complete").notNull().default(false),

    // ── Sync metadata ─────────────────────────────────────────────────────────
    // Lovable calls POST /api/profile/sync whenever the profile changes.
    syncedAt:        timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("up_industry_idx").on(t.industry),
    index("up_subtype_idx").on(t.businessSubtype),
  ]
);

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  createdAt: true, updatedAt: true, syncedAt: true,
});
export const selectUserProfileSchema = createSelectSchema(userProfiles);

export type UserProfile       = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
