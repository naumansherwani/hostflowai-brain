// ─────────────────────────────────────────────────────────────────────────────
// Monthly Report Generator
// Sherlock generates a personalized industry briefing for every active user.
// Sent from revenuereport@hostflowai.net once a month.
//
// Flow:
//   1. Query user_profiles — all users with email + onboarding complete
//   2. Per user: GPT-5 generates Sherlock's industry briefing (their industry)
//   3. Send from revenuereport@hostflowai.net
//   4. Returns a batch summary
// ─────────────────────────────────────────────────────────────────────────────

import { sendMail } from "./mailer.js";

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

const INDUSTRY_FULL_NAMES: Record<string, string> = {
  hospitality:          "Travel, Tourism & Hospitality",
  tourism_hospitality:  "Travel, Tourism & Hospitality",
  airlines:             "Airlines & Aviation",
  car_rental:           "Car Rental & Mobility",
  healthcare:           "Healthcare & Clinics",
  education:            "Education & Training",
  logistics:            "Logistics & Shipping",
  events_entertainment: "Events & Entertainment",
  railways:             "Railways & Train Services",
};

const ADVISOR_BY_INDUSTRY: Record<string, string> = {
  hospitality:          "Aria",
  tourism_hospitality:  "Aria",
  airlines:             "Captain Orion",
  car_rental:           "Rex",
  healthcare:           "Dr. Lyra",
  education:            "Professor Sage",
  logistics:            "Atlas",
  events_entertainment: "Vega",
  railways:             "Conductor Kai",
};

export interface MonthlyReportUser {
  userId:       string;
  email:        string;
  displayName:  string;
  businessName?: string;
  industry:     string;
  plan:         string;
}

export interface MonthlyReportResult {
  userId:    string;
  email:     string;
  industry:  string;
  status:    "sent" | "skipped" | "failed";
  reason?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate Sherlock's monthly briefing for a single user
// ─────────────────────────────────────────────────────────────────────────────
async function generateBriefing(user: MonthlyReportUser, month: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL!, apiKey: AI_API_KEY! });

  const industryFull = INDUSTRY_FULL_NAMES[user.industry] ?? user.industry;
  const advisorName  = ADVISOR_BY_INDUSTRY[user.industry]  ?? "your advisor";
  const name         = user.displayName || user.businessName || "there";

  const systemPrompt = `You are Sherlock, Chief Intelligence Officer at HostFlow AI.
You are writing a personal monthly intelligence briefing to a ${industryFull} business owner.

Their name: ${name}
Business: ${user.businessName || "not specified"}
Plan: ${user.plan}
Their advisor: ${advisorName}
Month: ${month}

Write a concise, high-value monthly briefing. Structure:
1. OPENING — 2 sentences. Personal, direct. Reference their industry specifically.
2. INDUSTRY INTELLIGENCE — 3 bullet points. Real-world trends in ${industryFull} right now. Specific, not generic.
3. YOUR AI ADVANTAGE — 2 bullet points. What HostFlow AI's ${advisorName} is doing for them this month specifically.
4. YOUR ACTION ITEM — 1 bold recommendation for this month. Max 2 sentences.
5. CLOSING — 1 sentence. No corporate speak.

Rules:
- Max 300 words total
- No generic advice ("focus on customer satisfaction") — be specific to ${industryFull}
- Mention specific metrics, percentages, or trends where possible
- Sign as: Sherlock | HostFlow AI
- Do NOT include subject line or email headers — body only`;

  const res = await client.chat.completions.create({
    model:    "gpt-5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: `Generate ${month} briefing for ${name}.` },
    ],
  });

  return (res.choices[0]?.message?.content ?? "").trim();
}

function buildReportHtml(
  user:     MonthlyReportUser,
  body:     string,
  month:    string,
): string {
  const industryFull = INDUSTRY_FULL_NAMES[user.industry] ?? user.industry;
  const advisorName  = ADVISOR_BY_INDUSTRY[user.industry]  ?? "Your Advisor";
  const name         = user.displayName || user.businessName || "there";

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px;">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:24px;border-radius:12px 12px 0 0;">
        <p style="margin:0;font-size:12px;letter-spacing:2px;opacity:.75;text-transform:uppercase">HostFlow AI · Monthly Intelligence</p>
        <h2 style="margin:8px 0 4px;font-size:22px">Your ${month} Briefing</h2>
        <p style="margin:0;opacity:.85">${industryFull} · Prepared by Sherlock</p>
      </div>
      <div style="background:#f8fafc;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
        <p style="color:#374151;font-size:15px;line-height:1.7;white-space:pre-wrap">${body}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <table style="width:100%;font-size:13px;color:#6b7280;">
          <tr>
            <td>Your advisor</td>
            <td style="color:#4f46e5;font-weight:600">${advisorName}</td>
          </tr>
          <tr>
            <td>Your plan</td>
            <td style="color:#111;text-transform:capitalize">${user.plan}</td>
          </tr>
          <tr>
            <td>Platform</td>
            <td><a href="https://www.hostflowai.net" style="color:#4f46e5">www.hostflowai.net</a></td>
          </tr>
        </table>
        <div style="margin-top:24px;padding:16px;background:#ede9fe;border-radius:8px;">
          <p style="margin:0;font-size:13px;color:#4f46e5">
            <strong>Hi ${name}</strong> — ${advisorName} is monitoring your operations 24/7.
            Message your advisor anytime inside HostFlow AI or reply to this email.
          </p>
        </div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch eligible users from DB
// ─────────────────────────────────────────────────────────────────────────────
async function fetchEligibleUsers(): Promise<MonthlyReportUser[]> {
  const { db, userProfiles } = await import("@workspace/db");
  const { isNotNull, ne }    = await import("drizzle-orm");

  const rows = await db
    .select({
      userId:       userProfiles.userId,
      email:        userProfiles.email,
      displayName:  userProfiles.displayName,
      businessName: userProfiles.businessName,
      industry:     userProfiles.industry,
      plan:         userProfiles.plan,
    })
    .from(userProfiles)
    .where(
      isNotNull(userProfiles.email)
    );

  return rows
    .filter(r =>
      r.email &&
      r.industry &&
      r.plan !== "trial" &&
      ne(userProfiles.plan, "trial")
    )
    .map(r => ({
      userId:       r.userId,
      email:        r.email!,
      displayName:  r.displayName ?? "",
      businessName: r.businessName ?? undefined,
      industry:     r.industry,
      plan:         r.plan,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — run monthly job
// ─────────────────────────────────────────────────────────────────────────────
export async function runMonthlyReports(
  options: {
    month?:      string;
    userIds?:    string[];
    dryRun?:     boolean;
    log?:        { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };
  } = {}
): Promise<{ sent: number; skipped: number; failed: number; results: MonthlyReportResult[] }> {
  if (!AI_BASE_URL || !AI_API_KEY) throw new Error("AI not configured");

  const now   = new Date();
  const month = options.month ?? now.toLocaleString("en-GB", { month: "long", year: "numeric" });

  const allUsers = await fetchEligibleUsers();
  const users    = options.userIds
    ? allUsers.filter(u => options.userIds!.includes(u.userId))
    : allUsers;

  options.log?.info({ total: users.length, month, dryRun: options.dryRun }, "Monthly report job started");

  const results: MonthlyReportResult[] = [];
  let sent = 0, skipped = 0, failed = 0;

  for (const user of users) {
    const industryFull = INDUSTRY_FULL_NAMES[user.industry] ?? user.industry;

    if (!industryFull) {
      results.push({ userId: user.userId, email: user.email, industry: user.industry, status: "skipped", reason: "unknown industry" });
      skipped++;
      continue;
    }

    try {
      const body = await generateBriefing(user, month);
      if (!body) throw new Error("AI returned empty briefing");

      if (!options.dryRun) {
        const html = buildReportHtml(user, body, month);
        const mailResult = await sendMail({
          to:       user.email,
          subject:  `Your ${month} Intelligence Briefing — HostFlow AI`,
          text:     body,
          html,
          identity: "revenue",
          fromName:  "Sherlock | HostFlow AI",
          fromEmail: "revenuereport@hostflowai.net",
          replyTo:   "sherlock@hostflowai.net",
        });

        if (!mailResult.success) throw new Error(mailResult.error ?? "Send failed");
      }

      results.push({ userId: user.userId, email: user.email, industry: user.industry, status: "sent" });
      sent++;
      options.log?.info({ userId: user.userId, industry: user.industry, dryRun: options.dryRun }, "Monthly briefing sent");

    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown error";
      results.push({ userId: user.userId, email: user.email, industry: user.industry, status: "failed", reason });
      failed++;
      options.log?.error({ err: e, userId: user.userId }, "Monthly briefing failed");
    }
  }

  options.log?.info({ sent, skipped, failed }, "Monthly report job complete");
  return { sent, skipped, failed, results };
}
