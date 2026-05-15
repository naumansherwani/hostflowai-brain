// ─────────────────────────────────────────────────────────────────────────────
// Founder Notification System
// Tiger sends, Sherlock signs. Both emails always get a copy.
//
// Founder primary:   naumankhansherwani@gmail.com
// Founder company:   naumansherwani@hostflowai.net
//
// Usage (fire-and-forget):
//   notifyFounder({ subject, body, priority, context })
//     .catch(() => {});
// ─────────────────────────────────────────────────────────────────────────────

import { sendMail } from "./mailer.js";

export type FounderNotificationPriority = "P0" | "P1" | "P2" | "info";

export interface FounderNotificationOptions {
  subject:   string;
  body:      string;
  priority:  FounderNotificationPriority;
  context?:  Record<string, unknown>;
  htmlBody?: string;
}

const FOUNDER_EMAILS = [
  "naumankhansherwani@gmail.com",
  "naumansherwani@hostflowai.net",
] as const;

const PRIORITY_LABELS: Record<FounderNotificationPriority, string> = {
  P0:   "🔴 P0 — CRITICAL",
  P1:   "🟠 P1 — HIGH",
  P2:   "🟡 P2 — MEDIUM",
  info: "ℹ️  INFO",
};

function buildFounderHtml(
  subject:  string,
  body:     string,
  priority: FounderNotificationPriority,
  context?: Record<string, unknown>,
): string {
  const priorityColors: Record<FounderNotificationPriority, string> = {
    P0:   "#dc2626",
    P1:   "#ea580c",
    P2:   "#ca8a04",
    info: "#4f46e5",
  };

  const ctxRows = context && Object.keys(context).length > 0
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        ${Object.entries(context).map(([k, v]) => `
          <tr>
            <td style="padding:6px 10px;color:#6b7280;white-space:nowrap">${k}</td>
            <td style="padding:6px 10px;color:#111;font-family:monospace">${String(v)}</td>
          </tr>`).join("")}
      </table>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px;">
      <div style="background:${priorityColors[priority]};color:#fff;padding:14px 24px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:12px;">
        <span style="font-size:20px;font-weight:700">${PRIORITY_LABELS[priority]}</span>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;">
        <h3 style="margin:0 0 12px;color:#111">${subject}</h3>
        <p style="color:#374151;white-space:pre-wrap;line-height:1.6">${body}</p>
        ${ctxRows}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="color:#6b7280;font-size:12px;margin:0">
          Sent by <strong>Sherlock</strong> — HostFlow AI Intelligence Layer<br>
          <a href="https://www.hostflowai.net" style="color:#4f46e5">www.hostflowai.net</a>
          &nbsp;·&nbsp; ${new Date().toUTCString()}
        </p>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — always sends to BOTH founder emails
// Fire-and-forget: never await in request handlers
// ─────────────────────────────────────────────────────────────────────────────
export async function notifyFounder(opts: FounderNotificationOptions): Promise<void> {
  const priorityPrefix = PRIORITY_LABELS[opts.priority];
  const fullSubject    = `[HostFlow AI] ${priorityPrefix} — ${opts.subject}`;
  const html           = opts.htmlBody ?? buildFounderHtml(opts.subject, opts.body, opts.priority, opts.context);

  await sendMail({
    to:       [...FOUNDER_EMAILS],
    subject:  fullSubject,
    text:     `${priorityPrefix}\n\n${opts.subject}\n\n${opts.body}${opts.context ? "\n\n" + JSON.stringify(opts.context, null, 2) : ""}\n\n— Sherlock | HostFlow AI`,
    html,
    identity: "owner",
    fromName:  "Sherlock | HostFlow AI",
    fromEmail: "sherlock@hostflowai.net",
    replyTo:   "sherlock@hostflowai.net",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers
// ─────────────────────────────────────────────────────────────────────────────
export function notifyFounderP0(subject: string, body: string, context?: Record<string, unknown>): void {
  notifyFounder({ subject, body, priority: "P0", context }).catch(() => {});
}

export function notifyFounderP1(subject: string, body: string, context?: Record<string, unknown>): void {
  notifyFounder({ subject, body, priority: "P1", context }).catch(() => {});
}

export function notifyFounderInfo(subject: string, body: string, context?: Record<string, unknown>): void {
  notifyFounder({ subject, body, priority: "info", context }).catch(() => {});
}
