import { Resend } from "resend";

// ─────────────────────────────────────────────────────────────────────────────
// Mailer — Resend only (Zoho SMTP removed permanently — May 2026)
// Provider: Resend.com — REST API, no IMAP/inbox reading
// Domain: hostflowai.net (DNS verified on Resend)
// All advisor FROM addresses are custom per advisor
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_KEY = process.env["RESEND_API_KEY"] ?? "";

export type MailIdentityType = "owner" | "advisor" | "resolved" | "revenue" | "enterprise";

const SYSTEM_FROM: Record<MailIdentityType, { name: string; email: string }> = {
  owner:      { name: "Sherlock | HostFlow AI",           email: "sherlock@hostflowai.net"        },
  advisor:    { name: "HostFlow AI Advisor",              email: "connectai@hostflowai.net"       },
  resolved:   { name: "HostFlow AI — Issue Resolved ✓",  email: "resolved@hostflowai.net"        },
  revenue:    { name: "HostFlow AI — Revenue Report",     email: "revenuereport@hostflowai.net"   },
  enterprise: { name: "Sherlock | HostFlow AI",           email: "connectai@hostflowai.net"       },
};

// ── Resend client (lazy init) ─────────────────────────────────────────────────
let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) _resend = new Resend(RESEND_KEY);
  return _resend;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface SendMailOptions {
  to:          string | string[];
  subject:     string;
  text:        string;
  html?:       string;
  identity:    MailIdentityType;
  fromName?:   string;
  fromEmail?:  string;
  replyTo?:    string;
  inReplyTo?:  string;
  language?:   string;
}

export interface SendMailResult {
  success:    boolean;
  messageId?: string;
  provider?:  "resend";
  error?:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL EMAIL KILL SWITCH
// Set EMAIL_ENABLED=true in env to allow sending. Default = OFF (silent drop).
// Founder controls this. No email fires unless explicitly enabled.
// ─────────────────────────────────────────────────────────────────────────────
function isEmailEnabled(): boolean {
  return process.env["EMAIL_ENABLED"]?.toLowerCase() === "true";
}

export async function sendMail(opts: SendMailOptions): Promise<SendMailResult> {
  // Kill switch — drop silently unless EMAIL_ENABLED=true
  if (!isEmailEnabled()) {
    return { success: false, error: "Email sending is disabled. Set EMAIL_ENABLED=true to enable.", provider: "resend" };
  }

  if (!RESEND_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured.", provider: "resend" };
  }

  const base      = SYSTEM_FROM[opts.identity];
  const fromName  = opts.fromName  ?? base.name;
  const fromEmail = opts.fromEmail ?? base.email;
  const replyTo   = opts.replyTo   ?? fromEmail;
  const toList    = Array.isArray(opts.to) ? opts.to : [opts.to];
  const htmlBody  = opts.html ?? opts.text.replace(/\n/g, "<br>");

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from:    `${fromName} <${fromEmail}>`,
      to:      toList,
      subject: opts.subject,
      text:    opts.text,
      html:    htmlBody,
      replyTo,
      headers: opts.inReplyTo
        ? { "In-Reply-To": opts.inReplyTo, "References": opts.inReplyTo }
        : undefined,
    });

    if (result.error) throw new Error(result.error.message);

    return { success: true, messageId: result.data?.id, provider: "resend" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Resend failed: ${msg}`, provider: "resend" };
  }
}

export function isMailConfigured(): boolean {
  return !!RESEND_KEY;
}

export function getActiveProvider(): "resend" | "none" {
  return RESEND_KEY ? "resend" : "none";
}
