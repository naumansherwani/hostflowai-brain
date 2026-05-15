import { pgTable, bigserial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Advisor Conversations — raw chat history per advisor per user
// Cap: 25,000 rows per (user_id, advisor). Oldest auto-pruned by app layer.
// user_id is text to support both UUID (chat/email) and phone (WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────
export const advisorConversations = pgTable(
  "advisor_conversations",
  {
    id:             bigserial("id", { mode: "number" }).primaryKey(),
    userId:         text("user_id").notNull(),
    advisor:        text("advisor").notNull(),
    industry:       text("industry").notNull(),
    sessionId:      text("session_id"),
    role:           text("role").notNull(),
    content:        text("content").notNull(),
    source:         text("source").notNull().default("chat"),
    importanceScore: integer("importance_score").notNull().default(0),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ac_user_advisor_created_idx").on(t.userId, t.advisor, t.createdAt),
    index("ac_session_idx").on(t.sessionId),
  ]
);

export const insertAdvisorConversationSchema = createInsertSchema(advisorConversations).omit({
  id: true,
  createdAt: true,
});

export type AdvisorConversation       = typeof advisorConversations.$inferSelect;
export type InsertAdvisorConversation = z.infer<typeof insertAdvisorConversationSchema>;
