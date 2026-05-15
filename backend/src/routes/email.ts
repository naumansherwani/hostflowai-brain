import { Router, type IRouter, type Request, type Response } from "express";
import { err, ok } from "../lib/response.js";
import { buildAdvisorEmailPrompt } from "../lib/advisor-email-prompt.js";
import { buildEmailAgentPrompt, SHERLOCK_ENTERPRISE_CONFIG, type EmailThread } from "../lib/email-agent-prompt.js";
import { getAdvisorByEmail, getAllAdvisors, OWNER_ADVISOR, ALL_ADVISOR_EMAILS } from "../lib/advisor-voice-config.js";
import { sendMail, isMailConfigured, getActiveProvider } from "../lib/mailer.js";
import { detectLanguage } from "../lib/language-detection.js";
import { desc, eq } from "drizzle-orm";
import { eventBus } from "../lib/event-bus.js";
import { verifyToken } from "../middleware/jwt.js";

const router: IRouter = Router();

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

const WEBHOOK_BASE = process.env["REPLIT_DOMAINS"]
  ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
  : "https://294617d8-2084-4895-8e41-8e7fdf1efde4-00-37kl744l50epn.riker.replit.dev";

// ─────────────────────────────────────────────────────────────────────────────
// Shared inbound email processor
// Called by both /api/email/inbound and /api/email/inbound/resend
// ─────────────────────────────────────────────────────────────────────────────
interface InboundEmailPayload {
  from:          string;
  from_name:     string;
  to:            string;
  subject:       string;
  text:          string;
  message_id:    string;
  thread_history: EmailThread[];
}

async function processInboundEmail(
  payload: InboundEmailPayload,
  traceId: string,
  log: Request["log"]
): Promise<{
  replied:       boolean;
  advisor:       string;
  advisor_email: string;
  escalated:     boolean;
  intent:        string;
  language:      string;
  language_name: string;
  provider:      string;
}> {
  const { from: senderEmail, from_name: senderName, to: toAddress, subject, text: emailBody, message_id: messageId, thread_history: threadHistory } = payload;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL!, apiKey: AI_API_KEY! });

  const detectedLang = await detectLanguage(emailBody, client);
  log.info({ lang: detectedLang.code, confidence: detectedLang.confidence }, "Language detected");

  const advisor        = getAdvisorByEmail(toAddress);
  const isAdvisorEmail = !!advisor;

  const advisorHandle = advisor?.emailHandle ?? "alex";
  const advisorIndustry = advisor?.industry ?? "enterprise";

  const [
    { recallMemory, saveConversationTurn },
    { extractAndStoreMemory },
  ] = await Promise.all([
    import("../lib/memory/recall.js"),
    import("../lib/memory/extract.js"),
  ]);

  const memory = await recallMemory(senderEmail, advisorHandle, advisorIndustry);

  let systemPrompt: string;
  let fromIdentity: { name: string; email: string };

  if (isAdvisorEmail && advisor) {
    systemPrompt = buildAdvisorEmailPrompt(advisor, senderName, senderEmail, subject, emailBody, threadHistory, detectedLang) + memory.memoryBlock;
    fromIdentity = { name: advisor.name, email: advisor.email };
  } else {
    const ctx = { senderName, senderEmail, subject, body: emailBody, threadHistory, receivedAt: new Date().toISOString() };
    systemPrompt = buildEmailAgentPrompt(ctx, SHERLOCK_ENTERPRISE_CONFIG) + memory.memoryBlock;
    fromIdentity = { name: "Sherlock | HostFlow AI", email: SHERLOCK_ENTERPRISE_CONFIG.agentEmail };
  }

  saveConversationTurn(senderEmail, advisorHandle, advisorIndustry, messageId, "user", `[${subject}]\n${emailBody}`, "email").catch(() => {});

  const classifyRes = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: `Classify into ONE word only (no explanation): inquiry | support | complaint | partnership | billing | spam | other\nSubject: ${subject}\nBody: ${emailBody.slice(0, 200)}` },
      { role: "user", content: "classify" },
    ],
  });

  const intent = (classifyRes.choices[0]?.message?.content ?? "other").trim().toLowerCase().replace(/[^a-z]/g, "") || "other";

  const replyRes = await client.chat.completions.create({
    model:    "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: "Write the reply." },
    ],
  });

  const replyBody = (replyRes.choices[0]?.message?.content ?? "").trim();
  log.info({ replyLen: replyBody.length, finishReason: replyRes.choices[0]?.finish_reason }, "AI reply generated");
  if (!replyBody) throw new Error(`AI returned empty reply — finish_reason: ${replyRes.choices[0]?.finish_reason ?? "unknown"}`);

  const needsEscalation = replyBody.includes("ESCALATE_TO_SHERLOCK");

  if (needsEscalation && isAdvisorEmail && advisor) {
    const sherlockPrompt = buildAdvisorEmailPrompt(
      OWNER_ADVISOR, senderName, senderEmail, subject,
      `[Escalated from ${advisor.name}]\n\n${emailBody}`,
      threadHistory, detectedLang
    );
    const sherlockRes = await client.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "system", content: sherlockPrompt }, { role: "user", content: "Write the reply." }],
    });
    const sherlockReply = sherlockRes.choices[0]?.message?.content?.trim() ?? replyBody;

    await sendMail({
      to: senderEmail, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      text: sherlockReply, identity: "owner",
      fromName: OWNER_ADVISOR.name, fromEmail: OWNER_ADVISOR.email,
      replyTo: OWNER_ADVISOR.email, inReplyTo: messageId,
    });

    await logEmailActivity(advisor.industry, senderEmail, subject, intent, sherlockReply, true, traceId);

    return {
      replied: true, advisor: OWNER_ADVISOR.name, advisor_email: OWNER_ADVISOR.email,
      escalated: true, intent, language: detectedLang.code, language_name: detectedLang.name, provider: "resend",
    };
  }

  const sendResult = await sendMail({
    to: senderEmail, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    text: replyBody, identity: isAdvisorEmail ? "advisor" : "enterprise",
    fromName: fromIdentity.name, fromEmail: fromIdentity.email,
    replyTo: fromIdentity.email, inReplyTo: messageId,
  });

  if (!sendResult.success) throw new Error(`Send failed: ${sendResult.error}`);

  await logEmailActivity(advisor?.industry ?? "enterprise", senderEmail, subject, intent, replyBody, false, traceId);

  // Save assistant reply + extract memory async
  saveConversationTurn(senderEmail, advisorHandle, advisorIndustry, messageId, "assistant", replyBody, "email").catch(() => {});
  extractAndStoreMemory({ userId: senderEmail, advisor: advisorHandle, industry: advisorIndustry, userMessage: `[${subject}]\n${emailBody}`, aiResponse: replyBody, source: "email" });

  // Store in inbox DB (fire-and-forget)
  storeInboundEmail({
    messageId, fromEmail: senderEmail, fromName: senderName, toAddress, subject,
    bodyText: emailBody, aiReply: replyBody,
    advisorName: fromIdentity.name, industry: advisor?.industry ?? "enterprise",
  }).catch(() => {});

  log.info({ to: senderEmail, advisor: fromIdentity.name, intent }, "Advisor email reply sent");

  return {
    replied: true, advisor: fromIdentity.name, advisor_email: fromIdentity.email,
    escalated: false, intent, language: detectedLang.code, language_name: detectedLang.name,
    provider: sendResult.provider ?? "resend",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/email/inbound/resend
// Resend inbound webhook — https://resend.com/docs/api-reference/webhooks
// Payload: { type: "email.received", data: { from, to: [], subject, text, html, headers } }
// Set this URL in Resend dashboard → Webhooks → Add Endpoint
// ─────────────────────────────────────────────────────────────────────────────
router.post("/email/inbound/resend", async (req: Request, res: Response) => {
  // ── Log raw body for debugging (Resend payload format may vary) ───────────
  req.log.info({ rawBodyKeys: Object.keys(req.body ?? {}), bodyType: (req.body as Record<string,unknown>)?.["type"], rawDataKeys: Object.keys((req.body as Record<string,unknown>)?.["data"] as object ?? {}) }, "Resend inbound raw payload received");
  req.log.info({ fullPayload: JSON.stringify(req.body).slice(0, 2000) }, "Resend inbound FULL payload dump");

  const body = req.body as Record<string, unknown>;

  // ── Normalise payload — Resend sends EITHER flat OR { type, data } format ─
  // Flat format:   { from, to, subject, text, html, headers }
  // Wrapped format: { type: "email.received", data: { from, to, ... } }
  let emailData: Record<string, unknown>;

  if (body["type"] === "email.received" && body["data"] && typeof body["data"] === "object") {
    // Wrapped format
    emailData = body["data"] as Record<string, unknown>;
  } else if (body["from"] || body["to"]) {
    // Flat format — Resend inbound sends this directly
    emailData = body;
  } else {
    // Unknown format — log and ack
    req.log.warn({ body: JSON.stringify(body).slice(0, 500) }, "Resend inbound: unrecognised payload — skipped");
    res.status(200).json({ received: true, skipped: "unrecognised_payload" });
    return;
  }

  // ── Parse fields (handles both string and array `to`) ────────────────────
  const senderRaw   = (emailData["from"] as string) ?? "";
  const nameMatch   = senderRaw.match(/^"?([^"<]+)"?\s*<?/);
  const senderName  = nameMatch?.[1]?.trim() ?? senderRaw.split("@")[0] ?? "there";
  const senderEmail = senderRaw.replace(/.*<(.+)>/, "$1").trim() || senderRaw;

  const toRaw   = emailData["to"];
  const toAddress = (Array.isArray(toRaw) ? (toRaw[0] as string) : (toRaw as string) ?? "").toLowerCase();

  const subject   = (emailData["subject"] as string) ?? "(No subject)";
  const emailBody = (emailData["text"] as string) ?? (emailData["html"] as string) ?? "";

  // Message-ID from headers (array or object format)
  const headers     = emailData["headers"] as Array<{ name: string; value: string }> | Record<string,string> | undefined;
  let messageId: string = crypto.randomUUID();
  if (Array.isArray(headers)) {
    messageId = headers.find(h => h.name?.toLowerCase() === "message-id")?.value ?? messageId;
  } else if (headers && typeof headers === "object") {
    messageId = String((headers["message-id"] ?? headers["Message-ID"]) ?? messageId);
  }

  req.log.info({ from: senderEmail, to: toAddress, subject }, "Resend inbound email received");

  // ── Auto-forward Supabase system emails (magic links, password resets) to Gmail ──
  // Must run BEFORE empty-body check — Supabase sends HTML-only emails
  const SUPABASE_SENDERS = ["noreply@mail.app.supabase.io", "noreply@supabase.io", "no-reply@supabase.io"];
  const FOUNDER_GMAIL    = "naumankhansherwani@gmail.com";
  const isSupabaseEmail  = SUPABASE_SENDERS.some(s => senderEmail.toLowerCase().includes(s.split("@")[1]!));
  const isToFounder      = toAddress === "naumansherwani@hostflowai.net";

  if (isSupabaseEmail && isToFounder) {
    // Resend inbound webhook only sends metadata — fetch full email body via API
    const emailId = (emailData["email_id"] as string) ?? (emailData["id"] as string) ?? "";
    req.log.info({ from: senderEmail, subject, emailId }, "Supabase system email — fetching full body from Resend API");
    (async () => {
      let htmlContent = (emailData["html"] as string) ?? "";
      let textContent = (emailData["text"] as string) ?? "";
      if (emailId && (!htmlContent && !textContent)) {
        try {
          const r = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: { "Authorization": `Bearer ${process.env["RESEND_API_KEY"]}` }
          });
          if (r.ok) {
            const full = await r.json() as Record<string, unknown>;
            htmlContent = (full["html"] as string) ?? "";
            textContent = (full["text"] as string) ?? "";
            req.log.info({ emailId, hasHtml: !!htmlContent, hasText: !!textContent }, "Resend email body fetched");
          }
        } catch (e) { req.log.warn({ err: e }, "Failed to fetch Resend email body"); }
      }
      const forwardBody = textContent || htmlContent || "(magic link body unavailable — check naumansherwani@hostflowai.net directly)";
      const result = await sendMail({
        to:       FOUNDER_GMAIL,
        subject:  `[Forwarded] ${subject}`,
        text:     `Forwarded from naumansherwani@hostflowai.net:\n\n${textContent || forwardBody}`,
        html:     `<p><strong>Forwarded from naumansherwani@hostflowai.net</strong></p><hr>${htmlContent || forwardBody.replace(/\n/g, "<br>")}`,
        identity: "owner",
      });
      req.log.info({ success: result.success, to: FOUNDER_GMAIL }, "Supabase email forwarded to Gmail");
    })();
    res.status(200).json({ received: true, forwarded: true, to: FOUNDER_GMAIL });
    return;
  }

  // ── Forward ALL emails to naumansherwani@hostflowai.net → Gmail ──
  // (covers user emails, customer queries, etc.)
  if (isToFounder) {
    const emailId = (emailData["email_id"] as string) ?? (emailData["id"] as string) ?? "";
    (async () => {
      let htmlContent = (emailData["html"] as string) ?? "";
      let textContent = (emailData["text"] as string) ?? "";
      if (emailId && (!htmlContent && !textContent)) {
        try {
          const r = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: { "Authorization": `Bearer ${process.env["RESEND_API_KEY"]}` }
          });
          if (r.ok) {
            const full = await r.json() as Record<string, unknown>;
            htmlContent = (full["html"] as string) ?? "";
            textContent = (full["text"] as string) ?? "";
          }
        } catch (e) { req.log.warn({ err: e }, "Failed to fetch Resend email body for founder forward"); }
      }
      const forwardBody = textContent || htmlContent || "(no body)";
      const result = await sendMail({
        to:       FOUNDER_GMAIL,
        subject:  `[To Founder] ${subject}`,
        text:     `From: ${senderEmail}\nTo: naumansherwani@hostflowai.net\n\n${textContent || forwardBody}`,
        html:     `<p><strong>From:</strong> ${senderEmail}</p><p><strong>To:</strong> naumansherwani@hostflowai.net</p><hr>${htmlContent || forwardBody.replace(/\n/g, "<br>")}`,
        identity: "owner",
      });
      req.log.info({ success: result.success, from: senderEmail, to: FOUNDER_GMAIL }, "Founder email forwarded to Gmail");
    })();
    res.status(200).json({ received: true, forwarded: true, to: FOUNDER_GMAIL });
    return;
  }

  if (!senderEmail || !emailBody) {
    res.status(200).json({ received: true, skipped: "empty sender or body" });
    return;
  }

  if (!AI_BASE_URL || !AI_API_KEY) {
    res.status(200).json({ received: true, skipped: "AI not configured" });
    return;
  }

  // ── Special: Revenue Report inbox ────────────────────────────────────────
  if (toAddress === "revenuereport@hostflowai.net") {
    try {
      const { processRevenueReport } = await import("../lib/revenue-report-processor.js");
      const result = await processRevenueReport(
        { submittedBy: senderEmail, submitterName: senderName, subject, rawContent: emailBody, source: "email", emailMessageId: messageId },
        req.log,
      );
      req.log.info({ reportId: result.id, status: result.status, from: senderEmail }, "Revenue report email processed");
      res.json({ received: true, type: "revenue_report", reportId: result.id, status: result.status });
    } catch (e) {
      req.log.error({ err: e, from: senderEmail }, "Revenue report email processing failed");
      res.status(200).json({ received: true, error: "revenue report processing failed — logged" });
    }
    return;
  }

  if (!isMailConfigured()) {
    res.status(200).json({ received: true, skipped: "mailer not configured" });
    return;
  }

  try {
    const result = await processInboundEmail(
      { from: senderEmail, from_name: senderName, to: toAddress, subject, text: emailBody, message_id: messageId, thread_history: [] },
      req.trace_id,
      req.log
    );
    res.json({ received: true, ...result });
  } catch (e) {
    req.log.error({ err: e, from: senderEmail, to: toAddress }, "Resend inbound processing failed");
    res.status(200).json({ received: true, error: "processing failed — logged" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/email/inbound  — Generic inbound (manual / other providers)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/email/inbound", async (req: Request, res: Response) => {
  const body = req.body as {
    from?:           string;
    from_name?:      string;
    to?:             string;
    subject?:        string;
    text?:           string;
    html?:           string;
    message_id?:     string;
    thread_history?: EmailThread[];
  };

  const toAddress   = (body.to ?? "").toLowerCase();
  const senderEmail = body.from ?? "";
  const senderName  = body.from_name ?? senderEmail.split("@")[0] ?? "there";
  const subject     = body.subject ?? "(No subject)";
  const emailBody   = body.text ?? body.html ?? "";
  const messageId   = body.message_id ?? crypto.randomUUID();
  const threadHistory: EmailThread[] = body.thread_history ?? [];

  if (!senderEmail || !emailBody) {
    res.status(400).json(err("VALIDATION_ERROR", "from and text/html are required", req.trace_id));
    return;
  }
  if (!AI_BASE_URL || !AI_API_KEY) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "AI service not configured", req.trace_id));
    return;
  }
  if (!isMailConfigured()) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "Email sending not configured — add RESEND_API_KEY", req.trace_id));
    return;
  }

  req.log.info({ to: toAddress, from: senderEmail, subject }, "Generic inbound email received");

  try {
    const result = await processInboundEmail(
      { from: senderEmail, from_name: senderName, to: toAddress, subject, text: emailBody, message_id: messageId, thread_history: threadHistory },
      req.trace_id,
      req.log
    );
    res.json(ok(result, req.trace_id));
  } catch (e) {
    req.log.error({ err: e, to: toAddress, from: senderEmail }, "Email advisor failed");
    res.status(500).json(err("EMAIL_AGENT_ERROR", "Email advisor processing failed", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/email/send  — Manual outbound
// ─────────────────────────────────────────────────────────────────────────────
router.post("/email/send", async (req: Request, res: Response) => {
  const { to, subject, body, from_address, from_name, identity } = req.body as {
    to:            string | string[];
    subject:       string;
    body:          string;
    from_address?: string;
    from_name?:    string;
    identity?:     string;
  };

  if (!to || !subject || !body) {
    res.status(400).json(err("VALIDATION_ERROR", "to, subject, and body are required", req.trace_id));
    return;
  }
  if (!isMailConfigured()) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "Email not configured — add RESEND_API_KEY", req.trace_id));
    return;
  }

  const result = await sendMail({
    to:       Array.isArray(to) ? to : [to],
    subject,
    text:     body,
    identity: (identity ?? "owner") as "owner" | "advisor" | "resolved" | "revenue" | "enterprise",
    fromName:  from_name,
    fromEmail: from_address,
  });

  if (!result.success) {
    res.status(500).json(err("EMAIL_SEND_ERROR", result.error ?? "Send failed", req.trace_id));
    return;
  }

  req.log.info({ to, subject }, "Outbound email sent");
  res.json(ok({ sent: true, message_id: result.messageId, provider: result.provider, to, subject }, req.trace_id));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/email/roster
// ─────────────────────────────────────────────────────────────────────────────
router.get("/email/roster", (_req, res) => {
  res.json(ok({
    advisor_emails: getAllAdvisors().map(a => ({ name: a.name, email: a.email, industry: a.industry, role: a.role })),
    owner_email:    { name: OWNER_ADVISOR.name, email: OWNER_ADVISOR.email, industry: "owner", role: OWNER_ADVISOR.role },
    system_emails: [
      { name: "HostFlow ConnectAI",  email: "connectai@hostflowai.net",     purpose: "Enterprise inbound — AI routes" },
      { name: "HostFlow Resolved",   email: "resolved@hostflowai.net",      purpose: "Issue resolution confirmations" },
      { name: "HostFlow Revenue",    email: "revenuereport@hostflowai.net", purpose: "Monthly revenue reports" },
      { name: "Nauman Sherwani",     email: "naumansherwani@hostflowai.net", purpose: "Founder — human escalation only" },
    ],
    total_addresses: ALL_ADVISOR_EMAILS.length + 1,
    dns_setup: {
      provider:        "Resend (primary) — hostflowai.net domain",
      inbound_webhook: `${WEBHOOK_BASE}/api/email/inbound/resend`,
      sending_from:    "All @hostflowai.net addresses via Resend DKIM-signed",
      records_needed:  ["TXT resend._domainkey (DKIM)", "TXT send (SPF)", "TXT _dmarc (DMARC)", "MX @ (Resend inbound)"],
    },
  }, "email-roster"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/email/status
// ─────────────────────────────────────────────────────────────────────────────
router.get("/email/status", (_req, res) => {
  res.json(ok({
    ai_configured:       !!(AI_BASE_URL && AI_API_KEY),
    mail_configured:     isMailConfigured(),
    active_provider:     getActiveProvider(),
    languages_supported: 15,
    language_list:       ["en","ar","ur","hi","es","fr","de","pt","zh","ja","ko","tr","it","ru","nl"],
    advisor_emails:      getAllAdvisors().length,
    total_emails:        ALL_ADVISOR_EMAILS.length + 1,
    detection:           "Real GPT-5 AI language detection — not mocked",
    endpoints: {
      inbound_resend: "POST /api/email/inbound/resend  ← set this in Resend Webhooks dashboard",
      inbound_generic:"POST /api/email/inbound",
      send:           "POST /api/email/send",
      roster:         "GET /api/email/roster",
      status:         "GET /api/email/status",
    },
    resend_webhook_url: `${WEBHOOK_BASE}/api/email/inbound/resend`,
  }, "email-status"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/email/inbox/stream  — SSE real-time inbox updates
//
// Auth: Browser EventSource API does not support custom headers.
// Solution: Accept JWT via ?token= query parameter (standard SSE auth pattern).
// Falls back to Authorization header for non-browser clients.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/email/inbox/stream", async (req: Request, res: Response) => {
  // Resolve token from ?token= query param OR Authorization header
  // NOTE: Fail-open — if no/invalid token, still establish SSE (don't crash component)
  const queryToken  = req.query["token"] as string | undefined;
  const headerToken = req.headers["authorization"]?.startsWith("Bearer ")
    ? req.headers["authorization"].slice(7)
    : undefined;
  const token = queryToken ?? headerToken;

  let userId = "anonymous";
  if (token) {
    try {
      req.user = await verifyToken(token);
      userId   = req.user.sub;
    } catch {
      // Invalid token — still allow SSE, just anonymous (prevents component crash)
      req.log.warn("SSE inbox stream: invalid token — connected as anonymous");
    }
  }

  const clientId = `inbox-${userId}-${crypto.randomUUID()}`;

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, userId, timestamp: new Date().toISOString() })}\n\n`);

  eventBus.register(clientId, res);

  // ── Heartbeat every 20s — keeps Replit proxy + browser alive ─────────────
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    eventBus.unregister(clientId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/email/inbox  — Paginated inbox (JWT-protected, admin sees all)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/email/inbox", async (req: Request, res: Response) => {
  try {
    const { db, inboundEmails } = await import("@workspace/db");

    const limit  = Math.min(Number(req.query["limit"]  ?? 50), 100);
    const offset = Number(req.query["offset"] ?? 0);
    const toFilter = req.query["to"] as string | undefined;

    const query = db
      .select()
      .from(inboundEmails)
      .$dynamic();

    const rows = await (
      toFilter
        ? query.where(eq(inboundEmails.toAddress, toFilter.toLowerCase()))
        : query
    )
      .orderBy(desc(inboundEmails.receivedAt))
      .limit(limit)
      .offset(offset);

    res.json(ok({ emails: rows, limit, offset, count: rows.length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Inbox fetch failed");
    res.status(500).json(err("INBOX_ERROR", "Failed to fetch inbox", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/email/inbox/:id/read  — Mark email as read
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/email/inbox/:id/read", async (req: Request, res: Response) => {
  try {
    const { db, inboundEmails } = await import("@workspace/db");
    const id = Number(req.params["id"]);
    if (!id) { res.status(400).json(err("VALIDATION_ERROR", "Invalid id", req.trace_id)); return; }
    await db.update(inboundEmails).set({ isRead: true }).where(eq(inboundEmails.id, id));
    res.json(ok({ id, isRead: true }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Mark read failed");
    res.status(500).json(err("INBOX_ERROR", "Failed to mark as read", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function storeInboundEmail(data: {
  messageId: string; fromEmail: string; fromName: string; toAddress: string;
  subject: string; bodyText: string; aiReply?: string; advisorName?: string; industry?: string;
}) {
  try {
    const { db, inboundEmails } = await import("@workspace/db");
    const [row] = await db.insert(inboundEmails).values({
      messageId: data.messageId, fromEmail: data.fromEmail, fromName: data.fromName,
      toAddress: data.toAddress, subject: data.subject, bodyText: data.bodyText,
      aiReply: data.aiReply, advisorName: data.advisorName, industry: data.industry,
      repliedAt: data.aiReply ? new Date() : null,
    }).onConflictDoNothing().returning();

    if (row) {
      eventBus.broadcast("inbox.new_email", {
        id:          row.id,
        fromEmail:   row.fromEmail,
        fromName:    row.fromName ?? "",
        toAddress:   row.toAddress,
        subject:     row.subject,
        advisorName: row.advisorName ?? "",
        industry:    row.industry ?? "",
        isRead:      row.isRead,
        receivedAt:  row.receivedAt?.toISOString() ?? new Date().toISOString(),
      }, data.messageId);
    }
  } catch { /* non-fatal */ }
}

async function logEmailActivity(industry: string, from: string, subject: string, intent: string, reply: string, escalated: boolean, traceId: string) {
  try {
    const { db, events } = await import("@workspace/db");
    await db.insert(events).values({
      eventType: "email.advisor.replied",
      payload: { industry, from, subject, intent, reply_preview: reply.slice(0, 200), escalated, trace_id: traceId },
    });
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/email/test-send  — Founder-only test email (no auth required for
//   local machine calls; verified via shared secret header)
// Body: { to?: string, subject?: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/email/test-send", async (req: Request, res: Response) => {
  const secret = req.headers["x-tiger-test"] as string | undefined;
  if (secret !== "tiger-founder-test-2026") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  const to      = (req.body as { to?: string }).to ?? "naumankhansherwani@gmail.com";
  const subject = (req.body as { subject?: string }).subject ?? "HostFlow AI — System Online ✅";

  const result = await sendMail({
    to,
    identity:  "owner",
    fromName:  "Sherlock | HostFlow AI",
    fromEmail: "sherlock@hostflowai.net",
    replyTo:   "sherlock@hostflowai.net",
    subject,
    text: [
      "Nauman bhai,",
      "",
      "Yeh HostFlow AI backend ka test email hai.",
      "",
      "Email system fully operational hai:",
      "  • Resend API: connected ✅",
      "  • From domain: sherlock@hostflowai.net ✅",
      "  • Founder Gmail: naumankhansherwani@gmail.com ✅",
      "  • Founder HostFlow: naumansherwani@hostflowai.net ✅",
      "",
      "Tiger autonomous mode active — checking every 15 minutes.",
      "Sherlock aur Tiger dono mil ke system monitor kar rahe hain.",
      "",
      "— Sherlock | HostFlow AI Intelligence Layer",
      "  www.hostflowai.net",
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:32px;">
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:20px 28px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;font-size:22px">HostFlow AI — System Online ✅</h2>
          <p style="margin:6px 0 0;opacity:.85;font-size:14px">Sherlock Intelligence Layer • ${new Date().toUTCString()}</p>
        </div>
        <div style="background:#f8fafc;padding:28px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;">
          <p style="color:#111;font-size:16px">Nauman bhai,</p>
          <p style="color:#374151">Yeh HostFlow AI backend ka official test email hai. Email system fully operational hai.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr style="background:#4f46e5;color:#fff;">
              <th colspan="2" style="padding:10px 16px;text-align:left;font-size:13px">System Status</th>
            </tr>
            <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #f1f5f9">Resend API</td><td style="padding:10px 16px;color:#16a34a;font-weight:700;border-bottom:1px solid #f1f5f9">Connected ✅</td></tr>
            <tr style="background:#f8fafc"><td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #f1f5f9">From Domain</td><td style="padding:10px 16px;color:#16a34a;font-weight:700;border-bottom:1px solid #f1f5f9">sherlock@hostflowai.net ✅</td></tr>
            <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #f1f5f9">Founder Gmail</td><td style="padding:10px 16px;color:#16a34a;font-weight:700;border-bottom:1px solid #f1f5f9">naumankhansherwani@gmail.com ✅</td></tr>
            <tr style="background:#f8fafc"><td style="padding:10px 16px;color:#6b7280;font-size:13px">Founder HostFlow</td><td style="padding:10px 16px;color:#16a34a;font-weight:700">naumansherwani@hostflowai.net ✅</td></tr>
          </table>
          <p style="color:#374151;font-size:14px;line-height:1.7">
            <strong>Tiger autonomous mode active</strong> — checking every 15 minutes.<br>
            Sherlock aur Tiger dono mil ke system monitor kar rahe hain.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="color:#6b7280;font-size:12px;margin:0">
            — <strong>Sherlock</strong> | HostFlow AI Intelligence Layer &nbsp;·&nbsp;
            <a href="https://www.hostflowai.net" style="color:#4f46e5">www.hostflowai.net</a>
          </p>
        </div>
      </div>`,
  });

  if (result.success) {
    req.log.info({ to, messageId: result.messageId }, "Test email sent successfully");
    res.json({ ok: true, to, messageId: result.messageId, provider: result.provider });
  } else {
    req.log.error({ to, error: result.error }, "Test email failed");
    res.status(500).json({ ok: false, error: result.error });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/email/contact  — Public contact form (no auth required)
// Lovable replitApi.ts invokeShim maps "contact-form" → this route
// ─────────────────────────────────────────────────────────────────────────────
router.post("/email/contact", async (req: Request, res: Response) => {
  const { name, email, message, subject } = req.body as {
    name?: string; email?: string; message?: string; subject?: string;
  };

  if (!name || !email || !message) {
    res.status(400).json(err("VALIDATION_ERROR", "name, email and message are required", (req as any).trace_id));
    return;
  }

  if (!isMailConfigured()) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "Email not configured", (req as any).trace_id));
    return;
  }

  const result = await sendMail({
    to: ["naumankhansherwani@gmail.com", "naumansherwani@hostflowai.net"],
    subject: subject ?? `Contact Form: ${name}`,
    text: `From: ${name} <${email}>\n\n${message}`,
    identity: "owner",
  });

  if (result.success) {
    res.json(ok({ sent: true }, (req as any).trace_id));
  } else {
    res.status(500).json(err("SEND_FAILED", result.error ?? "Failed to send", (req as any).trace_id));
  }
});

export default router;
