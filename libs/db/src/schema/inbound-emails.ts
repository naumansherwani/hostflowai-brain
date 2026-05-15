import {
  pgTable, bigserial, text, boolean,
  timestamp, index,
} from "drizzle-orm/pg-core";

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    messageId:   text("message_id").notNull().unique(),
    fromEmail:   text("from_email").notNull(),
    fromName:    text("from_name"),
    toAddress:   text("to_address").notNull(),
    subject:     text("subject").notNull(),
    bodyText:    text("body_text"),
    aiReply:     text("ai_reply"),
    advisorName: text("advisor_name"),
    industry:    text("industry"),
    isRead:      boolean("is_read").notNull().default(false),
    receivedAt:  timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    repliedAt:   timestamp("replied_at", { withTimezone: true }),
  },
  (t) => [
    index("inbound_emails_to_idx").on(t.toAddress),
    index("inbound_emails_received_idx").on(t.receivedAt),
  ],
);

export type InboundEmail    = typeof inboundEmails.$inferSelect;
export type NewInboundEmail = typeof inboundEmails.$inferInsert;
