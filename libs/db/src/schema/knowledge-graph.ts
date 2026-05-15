import { pgTable, bigserial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Graph — business entity relationships per user
// Example: Hotel → peak_season → December → causes → 22% booking surge
// ─────────────────────────────────────────────────────────────────────────────
export const knowledgeGraphNodes = pgTable(
  "knowledge_graph_nodes",
  {
    id:         bigserial("id", { mode: "number" }).primaryKey(),
    userId:     text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityName: text("entity_name").notNull(),
    properties: jsonb("properties").notNull().default({}),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kgn_user_type_name_idx").on(t.userId, t.entityType, t.entityName),
  ]
);

export const knowledgeGraphEdges = pgTable(
  "knowledge_graph_edges",
  {
    id:         bigserial("id", { mode: "number" }).primaryKey(),
    userId:     text("user_id").notNull(),
    fromEntity: text("from_entity").notNull(),
    toEntity:   text("to_entity").notNull(),
    relation:   text("relation").notNull(),
    weight:     integer("weight").notNull().default(50),
    properties: jsonb("properties").notNull().default({}),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kge_user_from_idx").on(t.userId, t.fromEntity),
    index("kge_user_relation_idx").on(t.userId, t.relation),
  ]
);

export const insertKnowledgeGraphNodeSchema = createInsertSchema(knowledgeGraphNodes).omit({ id: true, createdAt: true });
export const insertKnowledgeGraphEdgeSchema = createInsertSchema(knowledgeGraphEdges).omit({ id: true, createdAt: true });

export type KnowledgeGraphNode       = typeof knowledgeGraphNodes.$inferSelect;
export type InsertKnowledgeGraphNode = z.infer<typeof insertKnowledgeGraphNodeSchema>;
export type KnowledgeGraphEdge       = typeof knowledgeGraphEdges.$inferSelect;
export type InsertKnowledgeGraphEdge = z.infer<typeof insertKnowledgeGraphEdgeSchema>;
