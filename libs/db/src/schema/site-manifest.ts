import { pgTable, bigserial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const siteManifest = pgTable("site_manifest", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  source:      text("source").notNull().default("lovable"),
  version:     text("version"),
  payload:     jsonb("payload").notNull(),
  receivedAt:  timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SiteManifest    = typeof siteManifest.$inferSelect;
