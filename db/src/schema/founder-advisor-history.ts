import { pgTable, bigserial, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const founderAdvisorHistory = pgTable(
  "founder_advisor_history",
  {
    id:        bigserial("id", { mode: "number" }).primaryKey(),
    userId:    uuid("user_id").notNull(),
    role:      text("role").notNull(),
    content:   text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fah_user_created_idx").on(t.userId, t.createdAt),
  ]
);

export const insertFounderAdvisorHistorySchema = createInsertSchema(founderAdvisorHistory).omit({
  id: true,
  createdAt: true,
});

export type FounderAdvisorHistory    = typeof founderAdvisorHistory.$inferSelect;
export type InsertFounderAdvisorHistory = z.infer<typeof insertFounderAdvisorHistorySchema>;
