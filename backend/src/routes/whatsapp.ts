import { Router, type IRouter, type Request, type Response } from "express";
import { ok, err } from "../lib/response.js";
import { detectLanguage, buildLanguageInstruction } from "../lib/language-detection.js";
import { getAdvisor } from "../lib/advisor-voice-config.js";
import {
  buildIndustrySystemPrompt,
  INDUSTRY_DISPLAY,
  normalizeIndustrySlug,
  type UserContext,
} from "../lib/industry-advisor-prompts.js";

// ─────────────────────────────────────────────────────────────────────────────
// BILLING POLICY — PERMANENT, NEVER CHANGES
// WhatsApp conversation fees are charged by Meta directly to the USER's
// Meta Business account. HostFlow AI does NOT pay or subsidise any
// WhatsApp messaging costs. The user is fully responsible for their own
// Meta per-conversation billing.
// ─────────────────────────────────────────────────────────────────────────────
const WA_BILLING_POLICY = {
  payer:       "user",
  note:        "WhatsApp conversation fees are charged by Meta to the user's own Meta Business account. HostFlow AI does not pay or subsidise any WhatsApp messaging costs.",
  meta_pricing: "https://developers.facebook.com/docs/whatsapp/pricing",
} as const;

const router: IRouter = Router();

const AI_BASE_URL        = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY         = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
const WA_TOKEN           = process.env["WHATSAPP_TOKEN"]           ?? "";
const WA_VERIFY_TOKEN    = process.env["WHATSAPP_VERIFY_TOKEN"]    ?? "hostflowai_wa_verify";
const WA_PHONE_NUMBER_ID = process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "";

// 8 industries — shown to new users as numbered menu
const INDUSTRY_MENU = [
  { num: "1", key: "hospitality",          label: "Travel, Tourism & Hospitality" },
  { num: "2", key: "airlines",             label: "Airlines & Aviation"           },
  { num: "3", key: "car_rental",           label: "Car Rental"                    },
  { num: "4", key: "healthcare",           label: "Healthcare & Clinics"          },
  { num: "5", key: "education",            label: "Education & Training"          },
  { num: "6", key: "logistics",            label: "Logistics & Shipping"          },
  { num: "7", key: "events_entertainment", label: "Events & Entertainment"        },
  { num: "8", key: "railways",             label: "Railways & Train Services"     },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/webhook  — Meta verification handshake
// ─────────────────────────────────────────────────────────────────────────────
router.get("/whatsapp/webhook", (req: Request, res: Response) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
    req.log.info("WhatsApp webhook verified by Meta");
    res.status(200).send(challenge);
  } else {
    res.status(403).json(err("FORBIDDEN", "Invalid verify token", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook  — Incoming WhatsApp messages
// Always ACK 200 immediately (Meta requires within 20s), process async
// ─────────────────────────────────────────────────────────────────────────────
router.post("/whatsapp/webhook", async (req: Request, res: Response) => {
  res.status(200).json({ status: "received" });

  try {
    const body = req.body as WhatsAppWebhookBody;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        const contacts = change.value?.contacts ?? [];

        for (const msg of messages) {
          if (msg.type !== "text") continue;

          const userPhone  = msg.from;
          const userText   = msg.text?.body?.trim() ?? "";
          const senderName = contacts[0]?.profile?.name ?? userPhone;

          if (!userText) continue;

          req.log.info({ from: userPhone, len: userText.length }, "WhatsApp message received");

          processMessage({ userPhone, userText, senderName, msgId: msg.id })
            .catch(e => req.log.error({ err: e }, "WhatsApp processing failed"));
        }
      }
    }
  } catch (e) {
    req.log.error({ err: e }, "WhatsApp webhook parse error");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Core processor — onboarding flow + industry-aware advisor responses
// Onboarding steps: new → asked_industry → active
// ─────────────────────────────────────────────────────────────────────────────
async function processMessage(opts: {
  userPhone:  string;
  userText:   string;
  senderName: string;
  msgId:      string;
}) {
  const { userPhone, userText, senderName } = opts;
  if (!AI_BASE_URL || !AI_API_KEY) return;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

  // ── Load or create WhatsApp user record ──────────────────────────────────
  const waUser = await getOrCreateWaUser(userPhone, senderName);
  if (waUser.isBlocked) return;

  // ── Detect language ───────────────────────────────────────────────────────
  const lang = await detectLanguage(userText, client);
  const langInstruction = buildLanguageInstruction(lang);

  if (lang.code !== waUser.language) {
    await updateWaUser(userPhone, { language: lang.code });
  }

  // ── STEP 1: New user — greet + show industry menu ─────────────────────────
  if (waUser.onboardingStep === "new") {
    const greeting = buildGreetingMessage(senderName);
    await sendWhatsAppReply(userPhone, greeting);
    await updateWaUser(userPhone, { onboardingStep: "asked_industry" });
    await touchWaUser(userPhone);
    return;
  }

  // ── STEP 2: Waiting for industry selection ────────────────────────────────
  if (waUser.onboardingStep === "asked_industry") {
    const selectedIndustry = parseIndustrySelection(userText);

    if (selectedIndustry) {
      await updateWaUser(userPhone, {
        industry:       selectedIndustry,
        onboardingStep: "active",
      });
      await touchWaUser(userPhone);

      const advisor       = getAdvisor(selectedIndustry);
      const industryLabel = INDUSTRY_DISPLAY[selectedIndustry] ?? selectedIndustry;
      const intro         = `Hi ${senderName}! I'm *${advisor?.name ?? "your advisor"}*, your dedicated ${industryLabel} advisor at HostFlow AI. I'm available 24/7 to help you grow, fix issues, and spot revenue opportunities. What can I help you with today? 💼`;
      await sendWhatsAppReply(userPhone, intro);
      return;
    }

    // Could not parse — show menu again
    await sendWhatsAppReply(userPhone, buildIndustryMenuMessage());
    await touchWaUser(userPhone);
    return;
  }

  // ── STEP 3: Active user — full industry advisor response ──────────────────
  const industry = normalizeIndustrySlug(waUser.industry ?? "hospitality");
  const advisor  = getAdvisor(industry);
  const plan     = await getUserPlan(waUser.userId ?? null);

  const ctx: UserContext = {
    userId:   userPhone,
    email:    "",
    plan,
    industry,
  };

  const advisorHandle = advisor?.emailHandle ?? industry;

  const [
    { recallMemory, saveConversationTurn },
    { extractAndStoreMemory },
  ] = await Promise.all([
    import("../lib/memory/recall.js"),
    import("../lib/memory/extract.js"),
  ]);

  const memory = await recallMemory(userPhone, advisorHandle, industry);

  const systemPrompt = buildWhatsAppAdvisorSystemPrompt(
    advisor?.name ?? "AI Advisor",
    advisor?.role ?? "AI Advisor",
    industry,
    senderName,
    langInstruction,
    ctx
  ) + memory.memoryBlock;

  saveConversationTurn(userPhone, advisorHandle, industry, undefined, "user", userText, "whatsapp").catch(() => {});

  const aiRes = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userText },
    ],
  });

  const reply = aiRes.choices[0]?.message?.content?.trim() ?? "";
  if (!reply) return;

  await sendWhatsAppReply(userPhone, reply);
  await touchWaUser(userPhone);
  await logWhatsAppActivity(userPhone, userText, reply, lang.code, industry);

  saveConversationTurn(userPhone, advisorHandle, industry, undefined, "assistant", reply, "whatsapp").catch(() => {});
  extractAndStoreMemory({ userId: userPhone, advisor: advisorHandle, industry, userMessage: userText, aiResponse: reply, source: "whatsapp" });
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt: full industry context + WhatsApp format rules
// ─────────────────────────────────────────────────────────────────────────────
function buildWhatsAppAdvisorSystemPrompt(
  name:            string,
  role:            string,
  industry:        string,
  senderName:      string,
  langInstruction: string,
  ctx:             UserContext
): string {
  const industryContext = buildIndustrySystemPrompt(industry, ctx);

  return `${industryContext}

━━━━━━━━━━━━━━━━━━━━
WHATSAPP CHANNEL — STRICT FORMAT
━━━━━━━━━━━━━━━━━━━━
You are ${name}, ${role} at HostFlow AI. You are replying on WhatsApp right now.
Person: ${senderName} — address them by name naturally.

FORMAT RULES (WhatsApp native — no markdown rendering):
- Max 150 words per reply
- NO markdown headers (##, ###) — WhatsApp does not render them
- NO dashes for bullet lists — use numbers or plain sentences
- *bold* and _italic_ work natively in WhatsApp — use sparingly for emphasis
- Max 1 emoji per message, only if natural
- Conversational, direct — no corporate language
- End with a clear question or next step

You ARE the advisor — handle it directly. No tickets. No "contact support".

${langInstruction}
Reply entirely in the detected language.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding message builders
// ─────────────────────────────────────────────────────────────────────────────
function buildGreetingMessage(name: string): string {
  const lines = INDUSTRY_MENU.map(i => `${i.num}. ${i.label}`).join("\n");
  return `Hi ${name}! 👋 Welcome to HostFlow AI — your dedicated business advisor.

Which industry are you in? Reply with the number:

${lines}`;
}

function buildIndustryMenuMessage(): string {
  const lines = INDUSTRY_MENU.map(i => `${i.num}. ${i.label}`).join("\n");
  return `Please reply with the number of your industry:\n\n${lines}`;
}

function parseIndustrySelection(text: string): string | null {
  const t = text.trim().toLowerCase();

  // Exact number match: "1" .. "8"
  const byNum = INDUSTRY_MENU.find(i => i.num === t.replace(/\D/g, "").charAt(0));
  if (byNum && /^\d/.test(t)) return byNum.key;

  // Name / keyword match
  for (const item of INDUSTRY_MENU) {
    const keywords = item.key.replace(/_/g, " ").split(" ");
    if (keywords.some(k => t.includes(k)) || t.includes(item.label.toLowerCase().slice(0, 5))) {
      return item.key;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers — whatsapp_users table
// ─────────────────────────────────────────────────────────────────────────────
async function getOrCreateWaUser(phone: string, displayName: string) {
  const { db, whatsappUsers } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [existing] = await db
    .select()
    .from(whatsappUsers)
    .where(eq(whatsappUsers.phone, phone))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(whatsappUsers)
    .values({ phone, displayName, onboardingStep: "new", language: "en", messageCount: "0" })
    .returning();

  return created!;
}

async function updateWaUser(phone: string, patch: {
  industry?:       string;
  onboardingStep?: string;
  language?:       string;
}): Promise<void> {
  const { db, whatsappUsers } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db.update(whatsappUsers).set(patch).where(eq(whatsappUsers.phone, phone));
}

async function touchWaUser(phone: string): Promise<void> {
  const { db, whatsappUsers } = await import("@workspace/db");
  const { eq, sql: dsql } = await import("drizzle-orm");
  await db.update(whatsappUsers).set({
    messageCount:  dsql`(${whatsappUsers.messageCount}::int + 1)::text`,
    lastMessageAt: new Date(),
  }).where(eq(whatsappUsers.phone, phone));
}

async function getUserPlan(userId: string | null): Promise<string> {
  if (!userId) return "trial";
  try {
    const { db, subscriptions } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1);
    return row?.plan ?? "trial";
  } catch {
    return "trial";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta Cloud API — send reply
// ─────────────────────────────────────────────────────────────────────────────
async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) return;
  await fetch(`https://graph.facebook.com/v25.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity logging — non-fatal
// ─────────────────────────────────────────────────────────────────────────────
async function logWhatsAppActivity(
  phone: string, message: string, reply: string, lang: string, industry: string
): Promise<void> {
  try {
    const { db, events } = await import("@workspace/db");
    await db.insert(events).values({
      eventType: "whatsapp.message",
      payload: {
        phone_tail:      phone.slice(-4).padStart(phone.length, "*"),
        message_preview: message.slice(0, 100),
        reply_preview:   reply.slice(0, 100),
        language:        lang,
        industry,
        billing_policy:  "user_pays_meta_direct",  // policy tag on every log entry
      },
    });
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/connect  — Lovable dashboard reads this for setup guide
// ─────────────────────────────────────────────────────────────────────────────
router.get("/whatsapp/connect", (_req, res) => {
  res.json(ok({
    configured:   !!(WA_TOKEN && WA_PHONE_NUMBER_ID),
    webhook_url:  "GET+POST /api/whatsapp/webhook",
    verify_token: WA_VERIFY_TOKEN,
    billing:      WA_BILLING_POLICY,
    onboarding_flow: [
      "User sends first message → greeted, shown 8-industry menu",
      "User picks industry (1-8 or name) → dedicated advisor activates",
      "All future messages handled by their industry advisor 24/7",
      "Language auto-detected — responds in user's language (15 supported)",
    ],
    advisors: INDUSTRY_MENU.map(i => {
      const advisor = getAdvisor(i.key);
      return { industry: i.key, label: i.label, advisor: advisor?.name, email: advisor?.email };
    }),
    supported_languages: 15,
    escalation: "Complex issues auto-escalate to Sherlock (Head AI Advisor)",
  }, "whatsapp-connect"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/status
// ─────────────────────────────────────────────────────────────────────────────
router.get("/whatsapp/status", (_req, res) => {
  res.json(ok({
    configured:   !!(WA_TOKEN && WA_PHONE_NUMBER_ID),
    wa_token:     WA_TOKEN           ? "set" : "MISSING — add WHATSAPP_TOKEN env var",
    wa_phone_id:  WA_PHONE_NUMBER_ID ? "set" : "MISSING — add WHATSAPP_PHONE_NUMBER_ID env var",
    verify_token: WA_VERIFY_TOKEN,
    webhook_url:  "GET+POST /api/whatsapp/webhook",
    languages:    15,
    provider:     "Meta WhatsApp Business Cloud API",
    billing:      WA_BILLING_POLICY,
  }, "whatsapp-status"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/users  — Internal ops: registered WhatsApp users
// ─────────────────────────────────────────────────────────────────────────────
router.get("/whatsapp/users", async (_req, res) => {
  try {
    const { db, whatsappUsers } = await import("@workspace/db");
    const rows = await db
      .select({
        phone:          whatsappUsers.phone,
        displayName:    whatsappUsers.displayName,
        industry:       whatsappUsers.industry,
        language:       whatsappUsers.language,
        onboardingStep: whatsappUsers.onboardingStep,
        messageCount:   whatsappUsers.messageCount,
        lastMessageAt:  whatsappUsers.lastMessageAt,
      })
      .from(whatsappUsers)
      .orderBy(whatsappUsers.lastMessageAt);

    res.json(ok({
      total: rows.length,
      users: rows.map(r => ({
        ...r,
        phone: r.phone.slice(0, 4) + "****" + r.phone.slice(-4),  // privacy mask
      })),
    }, "whatsapp-users"));
  } catch {
    res.status(500).json(err("DB_ERROR", "Could not fetch users", ""));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface WhatsAppWebhookBody {
  object: string;
  entry: Array<{
    changes: Array<{
      value: {
        messages?: Array<{ from: string; id: string; type: string; text?: { body: string } }>;
        contacts?: Array<{ profile?: { name: string }; wa_id: string }>;
      };
    }>;
  }>;
}

export default router;
