import { pgTable, bigserial, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tracks every AI call per user — used for daily + hourly cap enforcement
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id:        bigserial("id", { mode: "number" }).primaryKey(),
    userId:    uuid("user_id").notNull(),
    endpoint:  text("endpoint").notNull(),   // e.g. "advisor.chat", "advisor.escalate", "voice.speak"
    industry:  text("industry"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("aul_user_created_idx").on(t.userId, t.createdAt),
    index("aul_user_endpoint_idx").on(t.userId, t.endpoint, t.createdAt),
  ]
);

export const insertAiUsageLogSchema = createInsertSchema(aiUsageLog).omit({
  id: true,
  createdAt: true,
});

export type AiUsageLog    = typeof aiUsageLog.$inferSelect;
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
