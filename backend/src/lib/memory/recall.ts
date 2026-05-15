// ─────────────────────────────────────────────────────────────────────────────
// Memory Recall — retrieve relevant memories for advisor prompt injection
// HostFlow Long-Term Memory Engine V2
// ─────────────────────────────────────────────────────────────────────────────

export interface RecalledMemory {
  memoryBlock:    string;   // formatted string → injected into system prompt
  hasProfile:     boolean;
  totalMemories:  number;
}

const MAX_MEMORIES_IN_PROMPT = 15;
const MAX_HISTORY_IN_PROMPT  = 20;

// ─── Conversation caps per tier ──────────────────────────────────────────────
// Founder (Muhammad Nauman Sherwani) → 200,000  (full session history)
// Sherlock (owner AI advisor)        →  50,000  (owner-side conversations)
// Industry advisors (all users)      →  25,000  (standard cap)
const FOUNDER_USER_ID        = "d089432d-5d6b-416e-bd29-abe913121d99";
const CAP_FOUNDER            = 200_000;
const CAP_SHERLOCK            =  50_000;
const CAP_STANDARD           =  25_000;

function getConversationCap(userId: string, advisor: string): number {
  if (userId === FOUNDER_USER_ID) return CAP_FOUNDER;
  if (advisor === "sherlock")     return CAP_SHERLOCK;
  return CAP_STANDARD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main recall function — called before every AI response
// ─────────────────────────────────────────────────────────────────────────────
export async function recallMemory(
  userId:   string,
  advisor:  string,
  industry: string
): Promise<RecalledMemory> {
  try {
    const { db, advisorMemoryVault, customer360Profiles, advisorConversations } = await import("@workspace/db");
    const { desc, eq, and, sql } = await import("drizzle-orm");

    // 1. Fetch top memories ranked by importance + revenue impact + recency
    const memories = await db
      .select()
      .from(advisorMemoryVault)
      .where(and(
        eq(advisorMemoryVault.userId, userId),
        eq(advisorMemoryVault.advisor, advisor)
      ))
      .orderBy(
        desc(advisorMemoryVault.importanceScore),
        desc(advisorMemoryVault.revenueImpactScore),
        desc(advisorMemoryVault.createdAt)
      )
      .limit(MAX_MEMORIES_IN_PROMPT);

    // 2. Fetch Customer 360 profile
    const [profile] = await db
      .select()
      .from(customer360Profiles)
      .where(eq(customer360Profiles.userId, userId))
      .limit(1);

    // 3. Fetch last N conversation turns for continuity
    const recentHistory = await db
      .select({ role: advisorConversations.role, content: advisorConversations.content })
      .from(advisorConversations)
      .where(and(
        eq(advisorConversations.userId, userId),
        eq(advisorConversations.advisor, advisor)
      ))
      .orderBy(desc(advisorConversations.createdAt))
      .limit(MAX_HISTORY_IN_PROMPT);

    // 4. Bump access counters async (non-blocking)
    if (memories.length > 0) {
      const ids = memories.map(m => m.id);
      db.update(advisorMemoryVault)
        .set({ timesAccessed: sql`times_accessed + 1`, lastAccessedAt: new Date() })
        .where(sql`id = ANY(${ids})`)
        .catch(() => { /* non-fatal */ });
    }

    // 5. Build formatted memory block
    const sections: string[] = [];

    if (profile) {
      sections.push(`━━ CUSTOMER 360 PROFILE ━━
Business: ${profile.businessName ?? "Not captured yet"}
Industry: ${profile.industry}
Language: ${profile.preferredLanguage}
Total interactions: ${profile.totalInteractions}
Profile completeness: ${profile.profileCompleteness}%
Business goals: ${JSON.stringify(profile.businessGoals)}
Known pain points: ${JSON.stringify(profile.painPoints)}
Revenue trends: ${JSON.stringify(profile.revenueTrends)}
Sherlock verdicts: ${JSON.stringify(profile.sherlockVerdicts)}`);
    }

    if (memories.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memories) {
        const type = m.memoryType;
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(`[${m.confidenceLevel.toUpperCase()} | imp:${m.importanceScore} | rev:${m.revenueImpactScore}] ${m.summary}`);
      }
      const memLines = Object.entries(grouped)
        .map(([type, items]) => `${type.toUpperCase().replace(/_/g, " ")}:\n${items.map(i => `  • ${i}`).join("\n")}`)
        .join("\n\n");
      sections.push(`━━ LONG-TERM MEMORY VAULT (${memories.length} memories) ━━\n${memLines}`);
    }

    if (recentHistory.length > 0) {
      const chronological = [...recentHistory].reverse();
      const historyLines = chronological
        .map(h => `[${h.role.toUpperCase()}]: ${h.content.slice(0, 300)}`)
        .join("\n");
      sections.push(`━━ RECENT CONVERSATION HISTORY (last ${recentHistory.length} turns) ━━\n${historyLines}`);
    }

    const memoryBlock = sections.length > 0
      ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMEMORY CONTEXT — DO NOT REPEAT THESE AS QUESTIONS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${sections.join("\n\n")}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nZERO-REPETITION PROTOCOL: Never ask for info already known above. Reference past interactions naturally.`
      : "";

    return {
      memoryBlock,
      hasProfile:    !!profile,
      totalMemories: memories.length,
    };

  } catch {
    return { memoryBlock: "", hasProfile: false, totalMemories: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Save a conversation turn (user or assistant message)
// Cap tiers:
//   Founder (Nauman) → 200,000 | Sherlock advisor → 50,000 | Others → 25,000
// ─────────────────────────────────────────────────────────────────────────────
export async function saveConversationTurn(
  userId:    string,
  advisor:   string,
  industry:  string,
  sessionId: string | undefined,
  role:      "user" | "assistant",
  content:   string,
  source:    "chat" | "email" | "whatsapp" = "chat"
): Promise<void> {
  try {
    const { db, advisorConversations } = await import("@workspace/db");
    const { eq, and, sql, asc } = await import("drizzle-orm");

    await db.insert(advisorConversations).values({
      userId, advisor, industry,
      sessionId: sessionId ?? null,
      role, content: content.slice(0, 4000),
      source,
      importanceScore: 0,
    });

    const cap = getConversationCap(userId, advisor);

    // Prune oldest rows if cap exceeded
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(advisorConversations)
      .where(and(
        eq(advisorConversations.userId, userId),
        eq(advisorConversations.advisor, advisor)
      ));

    if (cnt > cap) {
      const excess = cnt - cap;
      const oldest = await db
        .select({ id: advisorConversations.id })
        .from(advisorConversations)
        .where(and(
          eq(advisorConversations.userId, userId),
          eq(advisorConversations.advisor, advisor)
        ))
        .orderBy(asc(advisorConversations.createdAt))
        .limit(excess);

      if (oldest.length > 0) {
        await db.delete(advisorConversations)
          .where(sql`id = ANY(${oldest.map(r => r.id)})`);
      }
    }
  } catch {
    // Non-fatal — don't break the advisor response
  }
}
