import {
  pgTable, text, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// ota_connections — User's OTA channel connections
//
// Phase 1: Advisory intelligence — Aria uses property IDs for channel context.
// Phase 2 (coming): Live API sync via Channel Manager certification per platform.
//
// Supported channels:
//   booking_com | airbnb | vrbo | expedia | agoda |
//   direct_website | whatsapp | ai_crm
// ─────────────────────────────────────────────────────────────────────────────

export const otaConnections = pgTable("ota_connections", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:        text("user_id").notNull(),
  channel:       text("channel").notNull(),
  propertyId:    text("property_id").notNull(),
  propertyName:  text("property_name"),
  notes:         text("notes"),
  connectedAt:   timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("ota_connections_user_channel_uq").on(t.userId, t.channel),
  index("ota_connections_user_id_idx").on(t.userId),
  index("ota_connections_channel_idx").on(t.channel),
]);

export const insertOtaConnectionSchema = createInsertSchema(otaConnections, {
  channel:    z.string().min(1),
  propertyId: z.string().min(1),
});

export const selectOtaConnectionSchema = createSelectSchema(otaConnections);

export type OtaConnection       = typeof otaConnections.$inferSelect;
export type NewOtaConnection    = typeof otaConnections.$inferInsert;
