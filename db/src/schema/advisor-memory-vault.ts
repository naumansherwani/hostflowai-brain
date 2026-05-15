import { pgTable, bigserial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Advisor Memory Vault — structured long-term business intelligence
// Memory is NOT raw chat. It's distilled facts that shape future responses.
// user_id is text to support UUID (chat) and phone number (WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────
export const advisorMemoryVault = pgTable(
  "advisor_memory_vault",
  {
    id:                 bigserial("id", { mode: "number" }).primaryKey(),
    userId:             text("user_id").notNull(),
    advisor:            text("advisor").notNull(),
    industry:           text("industry").notNull(),
    memoryType:         text("memory_type").notNull(),
    summary:            text("summary").notNull(),
    rawContext:         text("raw_context").notNull().default(""),
    importanceScore:    integer("importance_score").notNull().default(50),
    revenueImpactScore: integer("revenue_impact_score").notNull().default(0),
    confidenceLevel:    text("confidence_level").notNull().default("medium"),
    timesAccessed:      integer("times_accessed").notNull().default(0),
    lastAccessedAt:     timestamp("last_accessed_at", { withTimezone: true }),
    createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("amv_user_advisor_importance_idx").on(t.userId, t.advisor, t.importanceScore),
    index("amv_user_type_idx").on(t.userId, t.memoryType),
  ]
);

export const insertAdvisorMemoryVaultSchema = createInsertSchema(advisorMemoryVault).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  timesAccessed: true,
  lastAccessedAt: true,
});

export type AdvisorMemoryVault       = typeof advisorMemoryVault.$inferSelect;
export type InsertAdvisorMemoryVault = z.infer<typeof insertAdvisorMemoryVaultSchema>;
