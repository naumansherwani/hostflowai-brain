// ─────────────────────────────────────────────────────────────────────────────
// Memory Extraction — post-response intelligence distillation
// HostFlow Long-Term Memory Engine V2
// Runs async after each advisor response (non-blocking)
// ─────────────────────────────────────────────────────────────────────────────

const AI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const AI_API_KEY  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

export interface ExtractMemoryParams {
  userId:        string;
  advisor:       string;
  industry:      string;
  userMessage:   string;
  aiResponse:    string;
  source:        "chat" | "email" | "whatsapp";
  isEscalation?: boolean;
  sherlockVerdict?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extraction function — fire and forget after each response
// ─────────────────────────────────────────────────────────────────────────────
export function extractAndStoreMemory(params: ExtractMemoryParams): void {
  // Non-blocking — runs in background
  _extract(params).catch(() => { /* silent — never interrupt advisor response */ });
}

async function _extract(params: ExtractMemoryParams): Promise<void> {
  const { userId, advisor, industry, userMessage, aiResponse, source, isEscalation, sherlockVerdict } = params;

  if (!AI_BASE_URL || !AI_API_KEY) return;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

  const extractionPrompt = `You are a business intelligence extraction engine for HostFlow AI.

Analyze this conversation between a business owner and their ${advisor} AI advisor (${industry} industry).

USER MESSAGE: ${userMessage.slice(0, 800)}
AI RESPONSE: ${aiResponse.slice(0, 800)}

Extract ONLY high-value business intelligence. Return a JSON array (max 5 items, can be empty []).

Each item: {
  "memory_type": "preference|business_goal|pain_point|revenue_pattern|resolution|recommendation|escalation_verdict|entity|seasonal_pattern",
  "summary": "concise 1-2 sentence distilled fact",
  "importance_score": 0-100,
  "revenue_impact_score": 0-100,
  "confidence_level": "high|medium|low"
}

EXTRACT if the conversation reveals:
- Business name, size, or operational details
- Revenue goals, targets, or patterns
- Recurring pain points or unresolved issues
- Seasonal trends (e.g., peak season, low season)
- Specific preferences or integrations
- Resolved issues worth remembering
- Escalation decisions by Sherlock

DO NOT extract generic greetings, casual chitchat, or redundant info.
Return ONLY valid JSON array. No explanation.`;

  let extracted: Array<{
    memory_type: string;
    summary: string;
    importance_score: number;
    revenue_impact_score: number;
    confidence_level: string;
  }> = [];

  try {
    const res = await client.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: extractionPrompt },
        { role: "user",   content: "extract" },
      ],
    });

    const raw = (res.choices[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      extracted = JSON.parse(jsonMatch[0]) as typeof extracted;
    }
  } catch {
    return;
  }

  if (extracted.length === 0) return;

  const { db, advisorMemoryVault, customer360Profiles } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");

  // Insert extracted memories
  for (const mem of extracted.slice(0, 5)) {
    const safeType = [
      "preference", "business_goal", "pain_point", "revenue_pattern",
      "resolution", "recommendation", "escalation_verdict", "entity", "seasonal_pattern",
    ].includes(mem.memory_type) ? mem.memory_type : "recommendation";

    await db.insert(advisorMemoryVault).values({
      userId,
      advisor,
      industry,
      memoryType:         safeType,
      summary:            String(mem.summary ?? "").slice(0, 500),
      rawContext:         `[${source}] U: ${userMessage.slice(0, 200)} | A: ${aiResponse.slice(0, 200)}`,
      importanceScore:    Math.max(0, Math.min(100, Number(mem.importance_score) || 50)),
      revenueImpactScore: Math.max(0, Math.min(100, Number(mem.revenue_impact_score) || 0)),
      confidenceLevel:    ["high", "medium", "low"].includes(mem.confidence_level) ? mem.confidence_level : "medium",
    }).catch(() => { /* non-fatal */ });
  }

  // Upsert Customer 360 profile — increment interaction count
  const now = new Date();
  const verdictEntry = isEscalation && sherlockVerdict
    ? [{ verdict: sherlockVerdict.slice(0, 300), at: now.toISOString() }]
    : null;

  await db
    .insert(customer360Profiles)
    .values({
      userId,
      industry,
      advisor,
      totalInteractions:   1,
      lastInteractionAt:   now,
      profileCompleteness: 5,
      ...(verdictEntry ? { sherlockVerdicts: verdictEntry } : {}),
    })
    .onConflictDoUpdate({
      target: customer360Profiles.userId,
      set: {
        totalInteractions:   sql`customer_360_profiles.total_interactions + 1`,
        lastInteractionAt:   now,
        profileCompleteness: sql`LEAST(customer_360_profiles.profile_completeness + 1, 100)`,
        updatedAt:           now,
        ...(verdictEntry ? {
          sherlockVerdicts: sql`customer_360_profiles.sherlock_verdicts || ${JSON.stringify(verdictEntry)}::jsonb`,
        } : {}),
      },
    })
    .catch(() => { /* non-fatal */ });
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Customer 360 with a specific field patch (e.g., business_name from email)
// ─────────────────────────────────────────────────────────────────────────────
export async function patchCustomer360(
  userId:   string,
  industry: string,
  advisor:  string,
  patch: {
    businessName?: string;
    preferredLanguage?: string;
    preferences?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { db, customer360Profiles } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const now = new Date();

    await db
      .insert(customer360Profiles)
      .values({
        userId, industry, advisor,
        businessName:      patch.businessName,
        preferredLanguage: patch.preferredLanguage ?? "en",
        totalInteractions:   0,
        profileCompleteness: 10,
      })
      .onConflictDoUpdate({
        target: customer360Profiles.userId,
        set: {
          ...(patch.businessName      ? { businessName: patch.businessName }           : {}),
          ...(patch.preferredLanguage ? { preferredLanguage: patch.preferredLanguage } : {}),
          updatedAt: now,
        },
      });
  } catch {
    // Non-fatal
  }
}
