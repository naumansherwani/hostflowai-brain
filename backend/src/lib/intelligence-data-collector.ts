// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Data Collector
// Pulls real platform data from all DB tables for the 10-section report
// No fabrication — only real numbers with honest confidence scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformDataSnapshot {
  period: {
    label:     string;
    type:      "monthly" | "quarterly" | "yearly";
    start:     Date;
    end:       Date;
  };

  // Subscriptions
  subscriptions: {
    total:       number;
    active:      number;
    trial:       number;
    basic:       number;
    pro:         number;
    premium:     number;
    enterprise:  number;
    newThisPeriod: number;
  };

  // AI usage
  aiUsage: {
    totalCalls:       number;
    callsThisPeriod:  number;
    byEndpoint:       Array<{ endpoint: string; count: number }>;
    byIndustry:       Array<{ industry: string; count: number }>;
    dailyAvg:         number;
  };

  // Conversations
  conversations: {
    totalStored:      number;
    newThisPeriod:    number;
    bySource:         { chat: number; email: number; whatsapp: number };
    byAdvisor:        Array<{ advisor: string; count: number; industry: string }>;
  };

  // Memory engine
  memory: {
    totalMemories:       number;
    newThisPeriod:       number;
    byType:              Array<{ type: string; count: number; avgImportance: number; avgRevenue: number }>;
    topRevenueMemories:  Array<{ summary: string; revenueScore: number; advisor: string }>;
    customer360Count:    number;
    avgProfileCompleteness: number;
  };

  // Knowledge graph
  knowledgeGraph: {
    totalNodes:   number;
    totalEdges:   number;
    nodesByType:  Array<{ type: string; count: number }>;
  };

  // WhatsApp
  whatsapp: {
    totalUsers:    number;
    activeUsers:   number;
    newThisPeriod: number;
  };

  // External revenue reports (from revenuereport@ email intake)
  externalReports: {
    count:            number;
    totalRevenue:     number;
    avgGrowthRate:    number | null;
    topIndustry:      string | null;
  };

  // Data quality
  dataQuality: {
    score:   number;   // 0-100 confidence in the data
    note:    string;   // human-readable quality note
  };
}

export async function collectPlatformData(
  periodStart: Date,
  periodEnd:   Date,
  periodLabel: string,
  periodType:  "monthly" | "quarterly" | "yearly"
): Promise<PlatformDataSnapshot> {

  const {
    db, subscriptions, aiUsageLog, advisorConversations,
    advisorMemoryVault, customer360Profiles,
    knowledgeGraphNodes, knowledgeGraphEdges,
    whatsappUsers, revenueReports,
  } = await import("@workspace/db");

  const { sql, gte, and, lte, eq } = await import("drizzle-orm");

  const inPeriod = and(
    gte(aiUsageLog.createdAt, periodStart),
    lte(aiUsageLog.createdAt, periodEnd),
  );

  // ── All queries in parallel ───────────────────────────────────────────────
  const [
    subRows,
    newSubRows,
    allAiCalls,
    periodAiRows,
    byEndpointRows,
    byIndustryRows,
    totalConvs,
    periodConvs,
    bySourceRows,
    byAdvisorRows,
    totalMems,
    periodMems,
    memByTypeRows,
    topRevMems,
    profiles,
    kgNodes,
    kgEdges,
    kgByTypeRows,
    waUsers,
    newWaUsers,
    extReports,
  ] = await Promise.all([
    // subscription counts
    db.select({
      plan:   subscriptions.plan,
      status: subscriptions.status,
      cnt:    sql<number>`count(*)::int`,
    }).from(subscriptions).groupBy(subscriptions.plan, subscriptions.status),

    // new subscriptions this period
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(and(gte(subscriptions.createdAt, periodStart), lte(subscriptions.createdAt, periodEnd))),

    // total AI calls ever
    db.select({ cnt: sql<number>`count(*)::int` }).from(aiUsageLog),

    // AI calls this period
    db.select({ cnt: sql<number>`count(*)::int` }).from(aiUsageLog).where(inPeriod),

    // AI calls by endpoint this period
    db.select({ endpoint: aiUsageLog.endpoint, cnt: sql<number>`count(*)::int` })
      .from(aiUsageLog).where(inPeriod)
      .groupBy(aiUsageLog.endpoint)
      .orderBy(sql`count(*) desc`)
      .limit(10),

    // AI calls by industry this period
    db.select({ industry: aiUsageLog.industry, cnt: sql<number>`count(*)::int` })
      .from(aiUsageLog).where(and(inPeriod, sql`industry is not null`))
      .groupBy(aiUsageLog.industry)
      .orderBy(sql`count(*) desc`),

    // total conversations
    db.select({ cnt: sql<number>`count(*)::int` }).from(advisorConversations),

    // conversations this period
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(advisorConversations)
      .where(and(
        gte(advisorConversations.createdAt, periodStart),
        lte(advisorConversations.createdAt, periodEnd),
      )),

    // by source this period
    db.select({ source: advisorConversations.source, cnt: sql<number>`count(*)::int` })
      .from(advisorConversations)
      .where(and(
        gte(advisorConversations.createdAt, periodStart),
        lte(advisorConversations.createdAt, periodEnd),
      ))
      .groupBy(advisorConversations.source),

    // by advisor
    db.select({
      advisor:  advisorConversations.advisor,
      industry: advisorConversations.industry,
      cnt:      sql<number>`count(*)::int`,
    })
      .from(advisorConversations)
      .where(and(
        gte(advisorConversations.createdAt, periodStart),
        lte(advisorConversations.createdAt, periodEnd),
      ))
      .groupBy(advisorConversations.advisor, advisorConversations.industry)
      .orderBy(sql`count(*) desc`),

    // total memories
    db.select({ cnt: sql<number>`count(*)::int` }).from(advisorMemoryVault),

    // memories this period
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(advisorMemoryVault)
      .where(and(
        gte(advisorMemoryVault.createdAt, periodStart),
        lte(advisorMemoryVault.createdAt, periodEnd),
      )),

    // memories by type with avg scores
    db.select({
      type:       advisorMemoryVault.memoryType,
      cnt:        sql<number>`count(*)::int`,
      avgImp:     sql<number>`round(avg(importance_score)::numeric,1)`,
      avgRev:     sql<number>`round(avg(revenue_impact_score)::numeric,1)`,
    }).from(advisorMemoryVault).groupBy(advisorMemoryVault.memoryType).orderBy(sql`count(*) desc`),

    // top revenue memories
    db.select({
      summary:      advisorMemoryVault.summary,
      revenueScore: advisorMemoryVault.revenueImpactScore,
      advisor:      advisorMemoryVault.advisor,
    })
      .from(advisorMemoryVault)
      .orderBy(sql`revenue_impact_score desc`)
      .limit(5),

    // customer 360 profiles
    db.select({
      cnt:             sql<number>`count(*)::int`,
      avgCompleteness: sql<number>`round(avg(profile_completeness)::numeric,1)`,
    }).from(customer360Profiles),

    // knowledge graph nodes
    db.select({ cnt: sql<number>`count(*)::int` }).from(knowledgeGraphNodes),

    // knowledge graph edges
    db.select({ cnt: sql<number>`count(*)::int` }).from(knowledgeGraphEdges),

    // kg nodes by type
    db.select({ type: knowledgeGraphNodes.entityType, cnt: sql<number>`count(*)::int` })
      .from(knowledgeGraphNodes).groupBy(knowledgeGraphNodes.entityType).orderBy(sql`count(*) desc`),

    // total WhatsApp users
    db.select({ cnt: sql<number>`count(*)::int` }).from(whatsappUsers),

    // new WhatsApp users this period
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(whatsappUsers)
      .where(and(gte(whatsappUsers.createdAt, periodStart), lte(whatsappUsers.createdAt, periodEnd))),

    // external revenue reports
    db.select({
      cnt:         sql<number>`count(*)::int`,
      totalRev:    sql<number>`coalesce(sum(total_revenue::numeric), 0)`,
      avgGrowth:   sql<number>`round(avg(growth_rate::numeric),2)`,
      topIndustry: sql<string>`mode() within group (order by industry)`,
    }).from(revenueReports).where(eq(revenueReports.status, "processed")),
  ]);

  // ── Parse subscription data ───────────────────────────────────────────────
  let totalSubs = 0, activeSubs = 0, trialSubs = 0, basicSubs = 0,
      proSubs = 0, premiumSubs = 0, entSubs = 0;

  for (const row of subRows) {
    totalSubs += row.cnt;
    if (row.status === "active")    activeSubs  += row.cnt;
    if (row.plan  === "trial")      trialSubs   += row.cnt;
    if (row.plan  === "basic")      basicSubs   += row.cnt;
    if (row.plan  === "pro")        proSubs     += row.cnt;
    if (row.plan  === "premium")    premiumSubs += row.cnt;
    if (row.plan  === "enterprise") entSubs     += row.cnt;
  }

  // ── Source breakdown ──────────────────────────────────────────────────────
  const sourceMap: Record<string, number> = {};
  for (const r of bySourceRows) sourceMap[r.source] = r.cnt;

  // ── Days in period ────────────────────────────────────────────────────────
  const dayCount = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000));

  // ── Data quality score ────────────────────────────────────────────────────
  const periodAiCount = periodAiRows[0]?.cnt ?? 0;
  let qualityScore = 100;
  if (periodAiCount  <  10) qualityScore -= 40;
  else if (periodAiCount < 50) qualityScore -= 20;
  if (totalSubs < 3)         qualityScore -= 20;

  const qualityNote = qualityScore >= 80
    ? "Strong data — high-confidence insights"
    : qualityScore >= 60
    ? "Moderate data — insights are directionally accurate"
    : "Low volume — early stage platform. Estimates carry wide confidence intervals.";

  const extRow = extReports[0]!;

  return {
    period: { label: periodLabel, type: periodType, start: periodStart, end: periodEnd },

    subscriptions: {
      total:         totalSubs,
      active:        activeSubs,
      trial:         trialSubs,
      basic:         basicSubs,
      pro:           proSubs,
      premium:       premiumSubs,
      enterprise:    entSubs,
      newThisPeriod: newSubRows[0]?.cnt ?? 0,
    },

    aiUsage: {
      totalCalls:      allAiCalls[0]?.cnt ?? 0,
      callsThisPeriod: periodAiCount,
      byEndpoint:      byEndpointRows.map(r => ({ endpoint: r.endpoint, count: r.cnt })),
      byIndustry:      byIndustryRows.map(r => ({ industry: r.industry ?? "unknown", count: r.cnt })),
      dailyAvg:        +(periodAiCount / dayCount).toFixed(1),
    },

    conversations: {
      totalStored:   (await db.select({ cnt: sql<number>`count(*)::int` }).from(advisorConversations))[0]?.cnt ?? 0,
      newThisPeriod: periodConvs[0]?.cnt ?? 0,
      bySource: {
        chat:      sourceMap["chat"]      ?? 0,
        email:     sourceMap["email"]     ?? 0,
        whatsapp:  sourceMap["whatsapp"]  ?? 0,
      },
      byAdvisor: byAdvisorRows.map(r => ({ advisor: r.advisor, count: r.cnt, industry: r.industry })),
    },

    memory: {
      totalMemories:          totalMems[0]?.cnt ?? 0,
      newThisPeriod:          periodMems[0]?.cnt ?? 0,
      byType:                 memByTypeRows.map(r => ({ type: r.type, count: r.cnt, avgImportance: r.avgImp, avgRevenue: r.avgRev })),
      topRevenueMemories:     topRevMems.map(r => ({ summary: r.summary, revenueScore: r.revenueScore, advisor: r.advisor })),
      customer360Count:       profiles[0]?.cnt ?? 0,
      avgProfileCompleteness: profiles[0]?.avgCompleteness ?? 0,
    },

    knowledgeGraph: {
      totalNodes:  kgNodes[0]?.cnt ?? 0,
      totalEdges:  kgEdges[0]?.cnt ?? 0,
      nodesByType: kgByTypeRows.map(r => ({ type: r.type, count: r.cnt })),
    },

    whatsapp: {
      totalUsers:    waUsers[0]?.cnt ?? 0,
      activeUsers:   waUsers[0]?.cnt ?? 0,
      newThisPeriod: newWaUsers[0]?.cnt ?? 0,
    },

    externalReports: {
      count:         extRow.cnt ?? 0,
      totalRevenue:  extRow.totalRev ?? 0,
      avgGrowthRate: extRow.avgGrowth ?? null,
      topIndustry:   extRow.topIndustry ?? null,
    },

    dataQuality: { score: Math.max(0, qualityScore), note: qualityNote },
  };
}
