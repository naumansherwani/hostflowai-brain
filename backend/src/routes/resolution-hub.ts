import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err }     from "../lib/response.js";
import { sql, eq, desc, and, or } from "drizzle-orm";
import { notifyFounderP1 } from "../lib/notify-founder.js";

const FOUNDER_USER_ID = "d089432d-5d6b-416e-bd29-abe913121d99";

function requireFounder(req: Request, res: Response): boolean {
  if (req.user?.sub !== FOUNDER_USER_ID) {
    res.status(403).json(err("FORBIDDEN", "AI Resolution Hub admin view is restricted to the founder account.", req.trace_id));
    return false;
  }
  return true;
}

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/count  — lightweight badge count (active + sherlock)
// Used by sidebar badge. No pagination. Fast.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/count", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");
    const [row] = await db
      .select({
        active:          sql<number>`count(*) filter (where status in ('active','monitoring'))::int`,
        sherlock_active: sql<number>`count(*) filter (where status = 'sherlock_active')::int`,
        total_open:      sql<number>`count(*) filter (where status in ('active','monitoring','sherlock_active'))::int`,
      })
      .from(aiResolutionIssues)
      .where(eq(aiResolutionIssues.userId, userId as unknown as string));

    res.json(ok({
      active:          row?.active          ?? 0,
      sherlock_active: row?.sherlock_active  ?? 0,
      total_open:      row?.total_open       ?? 0,
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub count failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch count", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/issues/active  — user's currently active issues
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/issues/active", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");
    const issues = await db
      .select()
      .from(aiResolutionIssues)
      .where(
        and(
          eq(aiResolutionIssues.userId, userId as unknown as string),
          or(
            eq(aiResolutionIssues.status, "active"),
            eq(aiResolutionIssues.status, "monitoring"),
            eq(aiResolutionIssues.status, "sherlock_active")
          )
        )
      )
      .orderBy(desc(aiResolutionIssues.createdAt))
      .limit(10);

    res.json(ok({ issues, count: issues.length }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub active issues failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch active issues", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/issues  — paginated issue list for current user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/issues", requireAuth, async (req: Request, res: Response) => {
  const userId   = req.user!.sub;
  const page     = Math.max(1, parseInt(req.query["page"]     as string ?? "1",  10));
  const pageSize = Math.min(50, parseInt(req.query["pageSize"] as string ?? "20", 10));
  const offset   = (page - 1) * pageSize;

  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");

    const [issues, totalRow] = await Promise.all([
      db.select()
        .from(aiResolutionIssues)
        .where(eq(aiResolutionIssues.userId, userId as unknown as string))
        .orderBy(desc(aiResolutionIssues.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(aiResolutionIssues)
        .where(eq(aiResolutionIssues.userId, userId as unknown as string)),
    ]);

    const total = totalRow[0]?.count ?? 0;
    res.json(ok({
      issues,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub issues list failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch issues", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/issues/:id  — single issue detail + conversation log
// Returns full issue object + messages[] from advisor_conversations via session_id
// messages[] is the conversation that triggered/belongs to this issue (max 200)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/issues/:id", requireAuth, async (req: Request, res: Response) => {
  const userId  = req.user!.sub;
  const issueId = parseInt(req.params["id"] as string, 10);

  if (isNaN(issueId)) {
    res.status(400).json(err("VALIDATION_ERROR", "Invalid issue ID", req.trace_id));
    return;
  }

  try {
    const { db, aiResolutionIssues, advisorConversations } = await import("@workspace/db");

    const [issue] = await db
      .select()
      .from(aiResolutionIssues)
      .where(
        and(
          eq(aiResolutionIssues.id, issueId),
          eq(aiResolutionIssues.userId, userId as unknown as string)
        )
      )
      .limit(1);

    if (!issue) {
      res.status(404).json(err("NOT_FOUND", "Issue not found", req.trace_id));
      return;
    }

    // Fetch conversation messages linked via session_id (max 200, chronological)
    const messages = issue.sessionId
      ? await db
          .select({
            id:        advisorConversations.id,
            role:      advisorConversations.role,
            content:   advisorConversations.content,
            createdAt: advisorConversations.createdAt,
          })
          .from(advisorConversations)
          .where(eq(advisorConversations.sessionId, issue.sessionId))
          .orderBy(advisorConversations.createdAt)
          .limit(200)
      : [];

    res.json(ok({ issue, messages }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub issue detail failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch issue", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/customer-stats  — customer issue history summary
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/customer-stats", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");

    const stats = await db
      .select({
        total:              sql<number>`count(*)::int`,
        resolved:           sql<number>`count(*) filter (where status = 'resolved')::int`,
        failed:             sql<number>`count(*) filter (where status = 'failed')::int`,
        sherlockEscalated:  sql<number>`count(*) filter (where escalated_to_sherlock = true)::int`,
        criticalIssues:     sql<number>`count(*) filter (where issue_type = 'critical')::int`,
        avgElapsedMs:       sql<number>`avg(elapsed_ms) filter (where elapsed_ms is not null)`,
        totalRevenueProtected: sql<string>`coalesce(sum(revenue_protected), 0)::text`,
      })
      .from(aiResolutionIssues)
      .where(eq(aiResolutionIssues.userId, userId as unknown as string));

    const row = stats[0] ?? {};
    const total    = row.total    ?? 0;
    const resolved = row.resolved ?? 0;

    res.json(ok({
      total_issues:           total,
      resolved_successfully:  resolved,
      failed_or_escalated:    row.failed ?? 0,
      sherlock_escalations:   row.sherlockEscalated ?? 0,
      critical_issues:        row.criticalIssues ?? 0,
      ai_resolution_rate:     total > 0 ? Math.round((resolved / total) * 100) : 0,
      avg_resolution_ms:      row.avgElapsedMs ? Math.round(Number(row.avgElapsedMs)) : null,
      avg_resolution_mins:    row.avgElapsedMs ? (Number(row.avgElapsedMs) / 60000).toFixed(1) : null,
      total_revenue_protected: row.totalRevenueProtected ?? "0",
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub customer stats failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch stats", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/resolution-hub/issues/:id/resolve  — manually resolve a ticket
// Marks issue resolved + sends resolved@ confirmation email to user
// Auth: requireAuth (any authenticated user can resolve their own; founder can resolve any)
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/resolution-hub/issues/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  const userId  = req.user!.sub;
  const issueId = parseInt(req.params["id"] as string, 10);

  if (isNaN(issueId)) {
    res.status(400).json(err("VALIDATION_ERROR", "Invalid issue ID", req.trace_id));
    return;
  }

  const { resolution_note, revenue_protected } = req.body as {
    resolution_note?:  string;
    revenue_protected?: number;
  };

  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");

    const isFounder = userId === FOUNDER_USER_ID;

    const [issue] = await db
      .select()
      .from(aiResolutionIssues)
      .where(
        isFounder
          ? eq(aiResolutionIssues.id, issueId)
          : and(eq(aiResolutionIssues.id, issueId), eq(aiResolutionIssues.userId, userId as unknown as string))
      )
      .limit(1);

    if (!issue) {
      res.status(404).json(err("NOT_FOUND", "Issue not found or access denied", req.trace_id));
      return;
    }

    if (issue.status === "resolved") {
      res.status(409).json(err("ALREADY_RESOLVED", "Issue is already resolved", req.trace_id));
      return;
    }

    const now       = new Date().toISOString();
    const elapsedMs = issue.createdAt ? Date.now() - new Date(issue.createdAt).getTime() : null;

    // Build final stages — always end with revenue_protected if revenue was set
    const finalStages: { stage: string; timestamp: string; message: string }[] = [];
    finalStages.push({
      stage:   "resolved",
      timestamp: now,
      message: resolution_note ? `Resolved: ${resolution_note.slice(0, 200)}` : "Issue resolved ✓",
    });
    if (revenue_protected && revenue_protected > 0) {
      finalStages.push({
        stage:   "revenue_protected",
        timestamp: now,
        message: `Revenue protected: ${revenue_protected} ${issue.revenueAtRiskCurrency ?? "GBP"} ✓`,
      });
    }

    await db.update(aiResolutionIssues)
      .set({
        status:              "resolved",
        resolvedAt:          sql`now()`,
        elapsedMs:           elapsedMs ?? undefined,
        revenueProtected:    revenue_protected?.toString() ?? issue.revenueProtected,
        resolvedEmailSent:   !!issue.userEmail,
        updatedAt:           sql`now()`,
        stages:              sql`stages || ${JSON.stringify(finalStages)}::jsonb`,
      })
      .where(eq(aiResolutionIssues.id, issueId));

    // Send resolved@ confirmation email to user (fire-and-forget)
    if (issue.userEmail) {
      const mins     = elapsedMs ? (elapsedMs / 60000).toFixed(1) : "N/A";
      const industry = issue.industry ?? "your industry";

      import("../lib/mailer.js").then(({ sendMail }) => {
        sendMail({
          to:       issue.userEmail!,
          identity: "resolved",
          subject:  `✓ Issue Resolved — ${issue.advisorName} | HostFlow AI`,
          text: [
            `Your issue has been resolved.`,
            ``,
            `Issue: ${issue.issueSummary?.slice(0, 200) ?? "(see dashboard)"}`,
            `Resolved by: ${issue.advisorName}`,
            `Resolution time: ${mins} minutes`,
            resolution_note ? `Note: ${resolution_note}` : "",
            ``,
            "Your AI advisor is available 24/7 for any further questions.",
            ``,
            `— Sherlock | HostFlow AI`,
            `https://www.hostflowai.net`,
          ].filter(Boolean).join("\n"),
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
              <div style="background:#16a34a;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
                <h2 style="margin:0">✓ Issue Resolved</h2>
                <p style="margin:4px 0 0;opacity:.85">${issue.advisorName} — HostFlow AI</p>
              </div>
              <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;">
                <p style="color:#374151">Your issue has been resolved successfully.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px;color:#6b7280;font-size:14px">Issue</td><td style="padding:8px;color:#111;font-size:14px">${(issue.issueSummary ?? "").slice(0, 200)}</td></tr>
                  <tr style="background:#fff"><td style="padding:8px;color:#6b7280;font-size:14px">Resolved by</td><td style="padding:8px;color:#111;font-size:14px">${issue.advisorName}</td></tr>
                  <tr><td style="padding:8px;color:#6b7280;font-size:14px">Industry</td><td style="padding:8px;color:#111;font-size:14px;text-transform:capitalize">${industry}</td></tr>
                  <tr style="background:#fff"><td style="padding:8px;color:#6b7280;font-size:14px">Resolution time</td><td style="padding:8px;color:#16a34a;font-size:14px;font-weight:600">${mins} minutes</td></tr>
                  ${resolution_note ? `<tr><td style="padding:8px;color:#6b7280;font-size:14px">Note</td><td style="padding:8px;color:#111;font-size:14px">${resolution_note}</td></tr>` : ""}
                </table>
                <p style="color:#6b7280;font-size:13px;margin-top:24px">Your AI advisor is available 24/7 for any further questions.</p>
                <a href="https://www.hostflowai.net" style="color:#6366f1;font-size:13px">www.hostflowai.net</a>
              </div>
            </div>`,
        }).catch(() => {});
      }).catch(() => {});

      // Notify Sherlock → Founder when critical issue is resolved
      if (issue.revenueRiskLevel === "critical" || issue.revenueRiskLevel === "high") {
        notifyFounderP1(
          `High-risk issue resolved — ${issue.advisorName}`,
          `A ${issue.revenueRiskLevel} risk issue has been resolved.\n\nAdvisor: ${issue.advisorName}\nIndustry: ${issue.industry}\nIssue: ${(issue.issueSummary ?? "").slice(0, 300)}\nResolution time: ${mins} minutes`,
          { issueId, userId: issue.userId, revenueRisk: issue.revenueRiskLevel }
        );
      }
    }

    req.log.info({ issueId, userId: issue.userId, advisorName: issue.advisorName }, "Issue manually resolved");
    res.json(ok({
      id:          issueId,
      status:      "resolved",
      elapsed_ms:  elapsedMs,
      email_sent:  !!issue.userEmail,
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e, issueId }, "Resolution hub resolve failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to resolve issue", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resolution-hub/admin/live  — all active issues (Founder only)
// Live operations center view — all users, all industries
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolution-hub/admin/live", requireAuth, async (req: Request, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const { db, aiResolutionIssues } = await import("@workspace/db");

    const active = await db
      .select()
      .from(aiResolutionIssues)
      .where(
        or(
          eq(aiResolutionIssues.status, "active"),
          eq(aiResolutionIssues.status, "monitoring"),
          eq(aiResolutionIssues.status, "sherlock_active")
        )
      )
      .orderBy(desc(aiResolutionIssues.revenueRiskLevel), desc(aiResolutionIssues.createdAt))
      .limit(100);

    const summary = await db
      .select({
        total_active:          sql<number>`count(*) filter (where status in ('active','monitoring','sherlock_active'))::int`,
        sherlock_active_count: sql<number>`count(*) filter (where status = 'sherlock_active')::int`,
        critical_risk_count:   sql<number>`count(*) filter (where revenue_risk_level = 'critical')::int`,
        total_today:           sql<number>`count(*) filter (where created_at >= now() - interval '24 hours')::int`,
        resolved_today:        sql<number>`count(*) filter (where status = 'resolved' and resolved_at >= now() - interval '24 hours')::int`,
      })
      .from(aiResolutionIssues);

    res.json(ok({ active_issues: active, summary: summary[0] ?? {} }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Resolution hub admin live failed");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to fetch live data", req.trace_id));
  }
});

export default router;
