import {
  pgTable, uuid, text, boolean, integer, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// whatsapp_crm_connections — CRM WhatsApp Connection per HostFlow user
//
// SURFACE: CRM (Premium only)
// INDUSTRY: All 8 industries
// PURPOSE:
//   Links a HostFlow user's personal WhatsApp number to their AI CRM account.
//   Once verified, the AI Advisor sends updates, insights, and notifications to
//   the user's WhatsApp. Bi-directional: user can also reply/query from WhatsApp.
//
// OTP FLOW:
//   1. User submits phone number → OTP generated (6-digit, 60s expiry)
//   2. OTP sent via WhatsApp Business API to that phone
//   3. User enters OTP → verified=true, otp_code cleared
//   4. Max 3 attempts — 4th attempt blocked until new OTP requested
//
// SECURITY:
//   - OTP stored hashed (SHA-256) in otp_code_hash — plain text never persisted
//   - otp_code column cleared immediately on successful verify
//   - Rate: 1 OTP request per phone per 60 seconds (enforced in route handler)
// ─────────────────────────────────────────────────────────────────────────────
export const whatsappCrmConnections = pgTable("whatsapp_crm_connections", {
  id:             uuid("id").primaryKey().defaultRandom(),
  userId:         uuid("user_id").notNull(),
  phone:          text("phone").notNull(),                         // E.164: +923001234567
  otpCodeHash:    text("otp_code_hash"),                           // SHA-256 of 6-digit OTP; null after verify
  otpExpiresAt:   timestamp("otp_expires_at",  { withTimezone: true }),
  otpAttempts:    integer("otp_attempts").notNull().default(0),    // max 3
  verified:       boolean("verified").notNull().default(false),
  connectedAt:    timestamp("connected_at",    { withTimezone: true }),
  lastMessageAt:  timestamp("last_message_at", { withTimezone: true }),
  createdAt:      timestamp("created_at",      { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at",      { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_wa_crm_user_id").on(t.userId),
  index("idx_wa_crm_phone").on(t.phone),
]);

export const insertWhatsappCrmConnectionSchema = createInsertSchema(whatsappCrmConnections).omit({
  id:        true,
  createdAt: true,
  updatedAt: true,
});

export type WhatsappCrmConnection       = typeof whatsappCrmConnections.$inferSelect;
export type InsertWhatsappCrmConnection = z.infer<typeof insertWhatsappCrmConnectionSchema>;
