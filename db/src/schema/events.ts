import { pgTable, text, uuid, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const events = pgTable("events", {
  eventId: uuid("event_id").primaryKey().defaultRandom(),
  traceId: uuid("trace_id"),
  parentEventId: uuid("parent_event_id"),
  idempotencyKey: text("idempotency_key"),
  userId: uuid("user_id"),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEventSchema = createInsertSchema(events).omit({
  eventId: true,
  createdAt: true,
});

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
