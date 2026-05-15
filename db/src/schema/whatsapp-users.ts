import { pgTable, text, uuid, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Users — maps phone number → HostFlow account + industry
// Created when a WhatsApp user first messages the system.
// Phone is stored hashed (SHA-256 prefix) for privacy.
// ─────────────────────────────────────────────────────────────────────────────
export const whatsappUsers = pgTable("whatsapp_users", {
  phone:           text("phone").primaryKey(),              // E.164 e.g. +923001234567
  userId:          uuid("user_id"),                         // linked HostFlow account (nullable — pre-signup)
  industry:        text("industry"),                        // null until user says which industry
  displayName:     text("display_name"),                    // from Meta contact profile
  language:        text("language").notNull().default("en"),// last detected language
  onboardingStep:  text("onboarding_step").notNull().default("new"),
  // onboarding_step: new | asked_industry | registered | active
  messageCount:    text("message_count").notNull().default("0"),
  isBlocked:       boolean("is_blocked").notNull().default(false),
  lastMessageAt:   timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at",      { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at",      { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWhatsappUserSchema = createInsertSchema(whatsappUsers).omit({
  lastMessageAt: true,
  createdAt:     true,
  updatedAt:     true,
});

export type WhatsappUser    = typeof whatsappUsers.$inferSelect;
export type InsertWhatsappUser = z.infer<typeof insertWhatsappUserSchema>;
