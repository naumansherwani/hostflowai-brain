import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { sovereignAuth, callJimmyAI, checkOllamaHealth, getAvailableProviders } from "../lib/jimmy-ai-core.js";

const router: IRouter = Router();

const auth = (req: Request, res: Response, next: () => void) => sovereignAuth(req, res, next);

// ─────────────────────────────────────────────────────────────────────────────
// JIMMY STATUS — One key, all endpoints visible
// GET /api/founder/jimmy/status
// Set FOUNDER_SECRET_KEY → all endpoints auto-activate
// ─────────────────────────────────────────────────────────────────────────────
const JIMMY_ENDPOINTS = [
  { phase: 1,  path: "POST /api/founder/jimmy/orchestrate",        name: "Sovereign Orchestrator",    status: "live" },
  { phase: 2,  path: "POST /api/founder/jimmy/strategic-brain",    name: "Founder Strategic Brain",   status: "live" },
  { phase: 6,  path: "POST /api/founder/jimmy/code",               name: "Autonomous Coding Engine",  status: "live" },
  { phase: 7,  path: "POST /api/founder/jimmy/build-ui",           name: "Frontend Builder",          status: "live" },
  { phase: 8,  path: "POST /api/founder/jimmy/devops",             name: "DevOps Autopilot",          status: "live" },
  { phase: 10, path: "POST /api/founder/jimmy/market-intel",       name: "Market Intelligence",       status: "live" },
  { phase: 11, path: "POST /api/founder/jimmy/social-media",       name: "Social Media Automation",   status: "live" },
  { phase: 12, path: "POST /api/founder/jimmy/sales",              name: "Sales Copilot",             status: "live" },
  { phase: 13, path: "POST /api/founder/jimmy/finance",            name: "Finance Copilot",           status: "live" },
  { phase: 14, path: "POST /api/founder/jimmy/product",            name: "Product Manager AI",        status: "live" },
  { phase: 15, path: "POST /api/founder/jimmy/legal",              name: "Legal & Compliance",        status: "live" },
  { phase: 17, path: "POST /api/founder/jimmy/orchestrate-agents", name: "Agent Orchestrator",        status: "live" },
  { phase: 18, path: "POST /api/founder/jimmy/self-improve",       name: "Self-Improvement Engine",   status: "live" },
  { phase: 20, path: "POST /api/founder/jimmy/operate",            name: "Autonomous Operator",       status: "live" },
  { phase: 4,  path: "POST /api/founder/jimmy/memory",             name: "Long-Term Memory",          status: "live" },
  { phase: 19, path: "POST /api/founder/jimmy/dashboard-intel",    name: "Executive Dashboard Intel", status: "live" },
];

router.get("/founder/jimmy/status", auth, async (req: Request, res: Response): Promise<void> => {
  const audit_id = randomUUID();
  const [ollama] = await Promise.all([checkOllamaHealth()]);
  const providers = getAvailableProviders();
  const liveEndpoints = JIMMY_ENDPOINTS.filter(e => e.status === "live");
  const pendingEndpoints = JIMMY_ENDPOINTS.filter(e => e.status !== "live");

  res.json({
    success: true,
    audit_id,
    jimmy: {
      identity: "Jimmy — Sovereign Founder AI of HostFlow AI",
      version: "2.0.0",
      key_status: "AUTHENTICATED",
      message: "All endpoints are active. One key unlocks everything.",
    },
    ai_engine: {
      primary: "ollama",
      model: process.env["JIMMY_MODEL"] ?? "qwen3:8b",
      ollama_healthy: ollama.ok,
      ollama_url: ollama.url,
      ollama_model: ollama.model,
      available_providers: providers,
    },
    endpoints: {
      total: JIMMY_ENDPOINTS.length,
      live: liveEndpoints.length,
      pending_supabase: pendingEndpoints.length,
      live_list: liveEndpoints,
      pending_list: pendingEndpoints,
    },
    how_to_call: {
      header: "X-Sovereign-Token: <your FOUNDER_SECRET_KEY>",
      example: `curl -X POST https://your-server/api/founder/jimmy/strategic-brain -H "X-Sovereign-Token: YOUR_KEY" -H "Content-Type: application/json" -d '{"topic":"HostFlow AI growth strategy"}'`,
    },
  });
});

function baseResponse(phase: number, phaseName: string) {
  return { audit_id: randomUUID(), phase, phase_name: phaseName };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Founder Strategic Brain
// POST /api/founder/jimmy/strategic-brain
// CEO-level: opportunity, risk, decision, recommendation analysis
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/strategic-brain", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(2, "Founder Strategic Brain");
  const { topic, context = {}, use_burst = false } = req.body as {
    topic?: string;
    context?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!topic?.trim()) {
    res.status(400).json({ success: false, error: "topic is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Sovereign Founder AI and strategic brain of HostFlow AI.
You operate as CEO-level advisor with full business authority.

CONTEXT: ${JSON.stringify(context)}

Your analysis must be structured as valid JSON with these exact keys:
{
  "executive_summary": "2-3 sentence CEO-level summary",
  "opportunities": ["array of concrete opportunities"],
  "risks": ["array of risks with severity: HIGH/MEDIUM/LOW prefix"],
  "decisions": ["array of decisions the founder should make NOW"],
  "recommendations": ["array of prioritized action items"],
  "confidence": "HIGH|MEDIUM|LOW",
  "timeframe": "immediate|short_term|long_term"
}

No markdown. Pure JSON only.`;

  try {
    const { response, provider } = await callJimmyAI(topic.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, analysis: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6 — Autonomous Coding Engine
// POST /api/founder/jimmy/code
// Write backend code, migrations, APIs, tests, fix bugs
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/code", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(6, "Autonomous Coding Engine");
  const { task, language = "typescript", context = "", use_burst = true } = req.body as {
    task?: string;
    language?: string;
    context?: string;
    use_burst?: boolean;
  };

  if (!task?.trim()) {
    res.status(400).json({ success: false, error: "task is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Sovereign Coding Engine of HostFlow AI.
Stack: Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, pnpm workspaces.
Language requested: ${language}
Context: ${context}

Rules:
- Write production-quality code only. No placeholders, no TODOs.
- Always include error handling.
- Follow existing HostFlow patterns: ok()/err() response helpers, requireAuth middleware, logger (never console.log).
- For DB: use Drizzle ORM with @workspace/db imports.
- Return structured JSON:
{
  "code": "complete production code here",
  "filename": "suggested filename",
  "dependencies": ["any new npm packages needed"],
  "migration_sql": "SQL migration if DB changes needed (or null)",
  "tests": "test cases if relevant (or null)",
  "explanation": "brief technical explanation"
}
No markdown fences around JSON.`;

  try {
    const { response, provider } = await callJimmyAI(task.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, result: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — Frontend Builder
// POST /api/founder/jimmy/build-ui
// Generate React + Tailwind components, dashboards, connect APIs
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/build-ui", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(7, "Frontend Builder");
  const { description, component_type = "component", context = "", use_burst = true } = req.body as {
    description?: string;
    component_type?: string;
    context?: string;
    use_burst?: boolean;
  };

  if (!description?.trim()) {
    res.status(400).json({ success: false, error: "description is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Frontend Builder AI of HostFlow AI.
Stack: React 18, Vite 5, Tailwind CSS v3, TypeScript 5, shadcn/ui components.
Design system: Dark theme, teal primary (hsl(168 70% 38%)), blue secondary (#0F66EE). Apple-minimal aesthetic.
Component type: ${component_type}
Context: ${context}

Rules:
- Production-ready code only. No placeholders.
- Use Tailwind classes only — no inline styles.
- Use shadcn/ui primitives where applicable.
- Responsive by default (mobile-first).
- Include TypeScript interfaces for all props.

Return JSON:
{
  "component_code": "complete TSX component",
  "component_name": "ComponentName",
  "props_interface": "TypeScript interface definition",
  "usage_example": "how to use this component",
  "tailwind_classes_used": ["list of key classes"],
  "dependencies": ["any additional imports needed"]
}`;

  try {
    const { response, provider } = await callJimmyAI(description.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, result: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8 — DevOps Autopilot
// POST /api/founder/jimmy/devops
// Hetzner deploy, PM2 management, health monitoring, rollbacks
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/devops", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(8, "DevOps Autopilot");
  const { task, server_context = {}, use_burst = false } = req.body as {
    task?: string;
    server_context?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!task?.trim()) {
    res.status(400).json({ success: false, error: "task is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the DevOps Autopilot of HostFlow AI.
Infrastructure: Hetzner CPX42 (88.198.208.90), Ubuntu 22.04, Node.js 22, PM2, UFW firewall.
App: hostflowai-brain at /opt/hostflowai-brain, port 8080.
GitHub: naumansherwani/hostflowai-brain (main branch).
Server context: ${JSON.stringify(server_context)}

You provide exact shell commands and deployment procedures.

Return JSON:
{
  "action": "what action to take",
  "commands": ["exact bash commands in order"],
  "verification": ["commands to verify success"],
  "rollback_commands": ["commands if something goes wrong"],
  "risk_level": "LOW|MEDIUM|HIGH",
  "estimated_downtime": "seconds of downtime or 'zero'",
  "explanation": "brief technical explanation"
}`;

  try {
    const { response, provider } = await callJimmyAI(task.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, result: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — Market Intelligence
// POST /api/founder/jimmy/market-intel
// Competitor analysis, trend monitoring, SEO opportunities
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/market-intel", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(10, "Market Intelligence");
  const { query, industry = "saas", competitors = [], use_burst = true } = req.body as {
    query?: string;
    industry?: string;
    competitors?: string[];
    use_burst?: boolean;
  };

  if (!query?.trim()) {
    res.status(400).json({ success: false, error: "query is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Market Intelligence Engine of HostFlow AI.
HostFlow AI is an AI-powered business automation OS for 8 industries (hospitality, airlines, car rental, healthcare, education, logistics, events, railways).
Target industry: ${industry}
Known competitors: ${competitors.join(", ") || "none specified"}

Provide deep market intelligence. Return JSON:
{
  "market_overview": "current state of the market",
  "competitor_analysis": [
    { "name": "competitor", "strengths": [], "weaknesses": [], "threat_level": "HIGH|MEDIUM|LOW" }
  ],
  "trends": ["key market trends with impact assessment"],
  "opportunities": ["specific actionable opportunities for HostFlow AI"],
  "threats": ["market threats to watch"],
  "seo_opportunities": ["specific keywords or content angles to pursue"],
  "positioning_recommendation": "how HostFlow AI should position against market",
  "confidence": "HIGH|MEDIUM|LOW"
}`;

  try {
    const { response, provider } = await callJimmyAI(query.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, intelligence: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 11 — Social Media Automation
// POST /api/founder/jimmy/social-media
// Generate posts, content strategy, performance reporting
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/social-media", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(11, "Social Media Automation");
  const { objective, platform = "linkedin", tone = "professional", context = "", use_burst = false } = req.body as {
    objective?: string;
    platform?: string;
    tone?: string;
    context?: string;
    use_burst?: boolean;
  };

  if (!objective?.trim()) {
    res.status(400).json({ success: false, error: "objective is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Social Media AI of HostFlow AI.
Brand: HostFlow AI — AI-powered business automation OS for 8 industries.
Platform: ${platform}
Tone: ${tone}
Context: ${context}

Create high-converting social media content. Return JSON:
{
  "posts": [
    {
      "content": "full post text ready to publish",
      "hashtags": ["relevant hashtags"],
      "best_time_to_post": "day and time recommendation",
      "expected_engagement": "HIGH|MEDIUM|LOW"
    }
  ],
  "content_strategy": "brief strategy note",
  "cta": "call to action recommendation",
  "variations": ["2-3 alternative versions of the main post"]
}`;

  try {
    const { response, provider } = await callJimmyAI(objective.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, content: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 12 — Sales Copilot
// POST /api/founder/jimmy/sales
// Lead scoring, outreach generation, follow-up automation
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/sales", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(12, "Sales Copilot");
  const { task, lead_data = {}, use_burst = false } = req.body as {
    task?: string;
    lead_data?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!task?.trim()) {
    res.status(400).json({ success: false, error: "task is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Sales Copilot of HostFlow AI.
Product: HostFlow AI — AI business automation OS. Plans: Basic $15/mo, Standard $39/mo, Premium $99/mo.
Lead data: ${JSON.stringify(lead_data)}

You help close deals, score leads, and write outreach. Return JSON:
{
  "lead_score": 0-100,
  "lead_tier": "HOT|WARM|COLD",
  "outreach_message": "personalized outreach email or message ready to send",
  "follow_up_sequence": ["day 1 action", "day 3 action", "day 7 action"],
  "objection_handling": { "price": "response", "timing": "response", "competitor": "response" },
  "recommended_plan": "basic|standard|premium",
  "closing_strategy": "specific closing approach for this lead",
  "next_action": "single most important next step"
}`;

  try {
    const { response, provider } = await callJimmyAI(task.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, result: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 13 — Finance Copilot
// POST /api/founder/jimmy/finance
// Cash flow, revenue forecasting, KPI dashboards
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/finance", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(13, "Finance Copilot");
  const { question, financial_data = {}, use_burst = false } = req.body as {
    question?: string;
    financial_data?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!question?.trim()) {
    res.status(400).json({ success: false, error: "question is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Finance Copilot of HostFlow AI.
Business model: SaaS subscriptions (Basic $15, Standard $39, Premium $99/mo) + Polar payments.
Financial data provided: ${JSON.stringify(financial_data)}

Provide CFO-level financial analysis. Return JSON:
{
  "summary": "executive financial summary",
  "mrr_analysis": { "current": null, "trend": null, "forecast_30d": null, "forecast_90d": null },
  "cash_flow": { "status": "positive|negative|breakeven", "runway_months": null, "burn_rate": null },
  "kpis": [{ "name": "KPI name", "value": null, "benchmark": null, "status": "good|warning|critical" }],
  "recommendations": ["specific financial actions"],
  "risks": ["financial risks identified"],
  "opportunities": ["revenue opportunities"],
  "forecast": "narrative 90-day financial forecast"
}`;

  try {
    const { response, provider } = await callJimmyAI(question.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, analysis: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 14 — Product Manager AI
// POST /api/founder/jimmy/product
// Roadmaps, PRDs, sprint planning
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/product", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(14, "Product Manager AI");
  const { request, deliverable = "roadmap", context = {}, use_burst = false } = req.body as {
    request?: string;
    deliverable?: "roadmap" | "prd" | "sprint" | "feature_spec";
    context?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!request?.trim()) {
    res.status(400).json({ success: false, error: "request is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Product Manager AI of HostFlow AI.
Product: HostFlow AI — AI-powered business automation OS for 8 industries.
Deliverable requested: ${deliverable}
Context: ${JSON.stringify(context)}

Return JSON based on deliverable type:
For roadmap: { "quarters": [{ "label": "Q1 2026", "themes": [], "features": [], "success_metrics": [] }], "north_star": "metric" }
For prd: { "problem_statement": "", "user_stories": [], "acceptance_criteria": [], "technical_requirements": [], "out_of_scope": [], "success_metrics": [] }
For sprint: { "sprint_goal": "", "tickets": [{ "id": "", "title": "", "type": "feature|bug|chore", "priority": "P0|P1|P2", "estimate_days": 1, "acceptance": "" }], "capacity_notes": "" }
For feature_spec: { "feature_name": "", "why": "", "what": "", "how": "", "api_contract": {}, "db_changes": "", "ui_changes": "", "effort": "S|M|L|XL" }`;

  try {
    const { response, provider } = await callJimmyAI(request.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, deliverable, result: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 15 — Legal & Compliance
// POST /api/founder/jimmy/legal
// Terms analysis, risk alerts, compliance tracking
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/legal", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(15, "Legal & Compliance");
  const { query, document_text = "", jurisdiction = "UK/EU", use_burst = false } = req.body as {
    query?: string;
    document_text?: string;
    jurisdiction?: string;
    use_burst?: boolean;
  };

  if (!query?.trim()) {
    res.status(400).json({ success: false, error: "query is required", ...meta });
    return;
  }

  const system = `You are Jimmy — the Legal & Compliance AI of HostFlow AI.
Company: HostFlow AI Technologies (Nauman Sherwani, hostflowai.net)
Jurisdiction: ${jurisdiction}
Business type: B2B SaaS — AI automation platform for hospitality, healthcare, education, logistics, airlines, car rental, events, railways.
Document/context: ${document_text.slice(0, 2000)}

IMPORTANT: This is AI-assisted legal analysis for internal review only. Always recommend consulting a qualified lawyer for final decisions.

Return JSON:
{
  "risk_level": "HIGH|MEDIUM|LOW|NONE",
  "summary": "plain English summary of the legal matter",
  "risks": [{ "issue": "", "severity": "HIGH|MEDIUM|LOW", "recommendation": "" }],
  "compliance_checklist": [{ "item": "", "status": "compliant|needs_review|non_compliant", "action": "" }],
  "gdpr_considerations": ["relevant GDPR points if applicable"],
  "recommended_clauses": ["suggested contract language if applicable"],
  "next_steps": ["prioritized legal action items"],
  "lawyer_required": true
}`;

  try {
    const { response, provider } = await callJimmyAI(query.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, analysis: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 17 — Agent Orchestrator
// POST /api/founder/jimmy/orchestrate-agents
// Delegate tasks to all 8 industry advisors, consolidate results
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/orchestrate-agents", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(17, "Agent Orchestrator");
  const { directive, target_industries, context = {}, use_burst = false } = req.body as {
    directive?: string;
    target_industries?: string[];
    context?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!directive?.trim()) {
    res.status(400).json({ success: false, error: "directive is required", ...meta });
    return;
  }

  const ALL_INDUSTRIES = [
    "hospitality", "airlines", "car_rental", "healthcare",
    "education", "logistics", "events_entertainment", "railways"
  ];
  const ADVISOR_NAMES: Record<string, string> = {
    hospitality: "Aria", airlines: "Captain Orion", car_rental: "Rex",
    healthcare: "Dr. Lyra", education: "Professor Sage", logistics: "Atlas",
    events_entertainment: "Vega", railways: "Conductor Kai"
  };

  const industries = (target_industries && target_industries.length > 0)
    ? target_industries.filter(i => ALL_INDUSTRIES.includes(i))
    : ALL_INDUSTRIES;

  const system = `You are Jimmy — the Master Orchestrator of HostFlow AI.
You are coordinating a multi-industry analysis across ${industries.length} industry advisors.
Each advisor covers their domain: ${industries.map(i => `${ADVISOR_NAMES[i]} (${i})`).join(", ")}.
Context: ${JSON.stringify(context)}

Analyze this directive from each advisor's perspective and synthesize findings.

Return JSON:
{
  "directive_summary": "what was asked",
  "industry_responses": {
    ${industries.map(i => `"${i}": { "advisor": "${ADVISOR_NAMES[i]}", "insight": "", "action": "", "priority": "HIGH|MEDIUM|LOW" }`).join(",\n    ")}
  },
  "consolidated_findings": "cross-industry synthesis",
  "common_patterns": ["patterns seen across industries"],
  "top_actions": ["top 5 actions ranked by impact"],
  "conflicts": ["any conflicting recommendations between industries"],
  "orchestration_verdict": "Jimmy's final unified recommendation"
}`;

  try {
    const { response, provider } = await callJimmyAI(directive.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, orchestration: parsed, industries_covered: industries, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 18 — Self-Improvement Engine
// POST /api/founder/jimmy/self-improve
// Learn from outcomes, prompt optimization, performance scoring
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/self-improve", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(18, "Self-Improvement Engine");
  const { original_prompt, jimmy_response, outcome, feedback = "", use_burst = false } = req.body as {
    original_prompt?: string;
    jimmy_response?: string;
    outcome?: "success" | "partial" | "failure";
    feedback?: string;
    use_burst?: boolean;
  };

  if (!original_prompt?.trim() || !jimmy_response?.trim() || !outcome) {
    res.status(400).json({ success: false, error: "original_prompt, jimmy_response, and outcome are required", ...meta });
    return;
  }

  const system = `You are Jimmy's Self-Improvement Engine — a meta-AI that analyzes Jimmy's own performance.

Analyze this interaction:
ORIGINAL PROMPT: ${original_prompt.slice(0, 1000)}
JIMMY'S RESPONSE: ${jimmy_response.slice(0, 1000)}
OUTCOME: ${outcome}
FOUNDER FEEDBACK: ${feedback}

Return JSON:
{
  "performance_score": 0-100,
  "quality_dimensions": {
    "accuracy": 0-100,
    "completeness": 0-100,
    "actionability": 0-100,
    "clarity": 0-100,
    "relevance": 0-100
  },
  "what_worked": ["specific strengths in this response"],
  "what_failed": ["specific weaknesses"],
  "improved_prompt_suggestion": "optimized version of the system prompt for this task type",
  "improved_response_example": "how Jimmy should have responded",
  "learning_tags": ["keywords for this pattern"],
  "apply_to_phases": ["which Jimmy phases benefit from this learning"]
}`;

  try {
    const { response, provider } = await callJimmyAI(
      `Analyze this Jimmy interaction and generate improvement report.`,
      system,
      use_burst as boolean
    );
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, improvement_report: parsed, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 20 — Autonomous Company Operator
// POST /api/founder/jimmy/operate
// Execute approved actions, manage systems end-to-end
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/operate", auth, async (req: Request, res: Response): Promise<void> => {
  const meta = baseResponse(20, "Autonomous Company Operator");
  const { command, approved = false, systems = [], context = {}, use_burst = true } = req.body as {
    command?: string;
    approved?: boolean;
    systems?: string[];
    context?: Record<string, unknown>;
    use_burst?: boolean;
  };

  if (!command?.trim()) {
    res.status(400).json({ success: false, error: "command is required", ...meta });
    return;
  }

  if (!approved) {
    res.status(403).json({
      success: false,
      error: "Autonomous operations require explicit founder approval. Send { approved: true } to proceed.",
      command_preview: command.trim().slice(0, 200),
      ...meta
    });
    return;
  }

  const system = `You are Jimmy — the Autonomous Company Operator of HostFlow AI.
You have been APPROVED by the founder to execute this operation.
Systems in scope: ${systems.join(", ") || "all systems"}
Company context: ${JSON.stringify(context)}

PRINCIPLES:
- Never make irreversible changes without listing a rollback plan.
- Backend is source of truth. Frontend is display only.
- No financial mutations without explicit confirmation.
- Every action must be auditable.

Plan and execute this operation. Return JSON:
{
  "operation_plan": "what will be done step by step",
  "systems_affected": ["list of systems touched"],
  "execution_steps": [
    { "step": 1, "action": "", "command_or_code": "", "expected_result": "", "rollback": "" }
  ],
  "risk_assessment": { "level": "LOW|MEDIUM|HIGH", "concerns": [] },
  "success_criteria": ["how to verify it worked"],
  "monitoring_alerts": ["what to watch after execution"],
  "estimated_duration": "time estimate",
  "human_review_required": true
}`;

  try {
    const { response, provider } = await callJimmyAI(command.trim(), system, use_burst as boolean);
    let parsed: unknown = response;
    try { parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? response); } catch { /* raw fallback */ }
    res.json({ success: true, operation: parsed, approved: true, provider, ...meta });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Long-Term Memory
// POST /api/founder/jimmy/memory
// action: "save" | "recall" | "summarize" | "clear_session"
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/memory", auth, async (req: Request, res: Response): Promise<void> => {
  const audit_id = randomUUID();
  const meta = { audit_id, phase: 4, endpoint: "memory", timestamp: new Date().toISOString() };
  const { action = "recall", content, tags = [], session_id, limit: queryLimit = 20 } = req.body as {
    action?: string; content?: string; tags?: string[]; session_id?: string; limit?: number;
  };

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ success: false, error: "Supabase not configured", ...meta });
    return;
  }

  const headers = { "Content-Type": "application/json", "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const dbUrl = `${supabaseUrl}/rest/v1`;

  try {
    if (action === "save") {
      if (!content) { res.status(400).json({ success: false, error: "content required for save", ...meta }); return; }
      const body = JSON.stringify({ content, tags, session_id: session_id ?? "default", created_at: new Date().toISOString() });
      const r = await fetch(`${dbUrl}/jimmy_long_term_memory`, { method: "POST", headers: { ...headers, "Prefer": "return=representation" }, body });
      const saved = await r.json();
      res.json({ success: true, action: "saved", record: saved, ...meta });

    } else if (action === "recall") {
      const url = new URL(`${dbUrl}/jimmy_long_term_memory`);
      url.searchParams.set("order", "created_at.desc");
      url.searchParams.set("limit", String(queryLimit));
      if (session_id) url.searchParams.set("session_id", `eq.${session_id}`);
      const r = await fetch(url.toString(), { headers });
      const memories = await r.json() as unknown[];
      const memText = (memories as Array<{ content?: string; created_at?: string; tags?: string[] }>)
        .map((m, i) => `[${i + 1}] ${m.content} (${m.created_at?.slice(0, 10)})`)
        .join("\n");

      const system = `You are Jimmy, Sovereign AI of HostFlow AI. You have access to the founder's stored memories and past context. Analyze and synthesize them.`;
      const prompt = content
        ? `Based on these memories:\n${memText}\n\nAnswer: ${content}`
        : `Summarize the most important insights from these memories:\n${memText}`;

      const { response, provider } = await callJimmyAI(prompt, system, false);
      res.json({ success: true, action: "recalled", memories_count: memories.length, synthesis: response, raw_memories: memories, provider, ...meta });

    } else if (action === "summarize") {
      const r = await fetch(`${dbUrl}/jimmy_long_term_memory?order=created_at.desc&limit=100`, { headers });
      const memories = await r.json() as Array<{ content?: string; created_at?: string }>;
      const memText = memories.map((m, i) => `[${i + 1}] ${m.content}`).join("\n");
      const system = `You are Jimmy. Create a powerful executive summary of all stored context.`;
      const { response, provider } = await callJimmyAI(`Summarize all memories:\n${memText}`, system, false);
      res.json({ success: true, action: "summarized", total_memories: memories.length, summary: response, provider, ...meta });

    } else if (action === "clear_session") {
      if (!session_id) { res.status(400).json({ success: false, error: "session_id required", ...meta }); return; }
      await fetch(`${dbUrl}/jimmy_long_term_memory?session_id=eq.${session_id}`, { method: "DELETE", headers });
      res.json({ success: true, action: "cleared", session_id, ...meta });

    } else {
      res.status(400).json({ success: false, error: `Unknown action: ${action}. Use: save|recall|summarize|clear_session`, ...meta });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 19 — Executive Dashboard Intelligence
// POST /api/founder/jimmy/dashboard-intel
// mode: "full" | "users" | "revenue" | "ai_usage" | "alerts"
// ─────────────────────────────────────────────────────────────────────────────
router.post("/founder/jimmy/dashboard-intel", auth, async (req: Request, res: Response): Promise<void> => {
  const audit_id = randomUUID();
  const meta = { audit_id, phase: 19, endpoint: "dashboard-intel", timestamp: new Date().toISOString() };
  const { mode = "full", question, date_from, date_to } = req.body as {
    mode?: string; question?: string; date_from?: string; date_to?: string;
  };

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ success: false, error: "Supabase not configured", ...meta });
    return;
  }

  const headers = { "Content-Type": "application/json", "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const dbUrl = `${supabaseUrl}/rest/v1`;

  try {
    const dateFilter = date_from ? `&created_at=gte.${date_from}` : "";

    // Fetch metrics in parallel
    const [usersRes, subRes, aiUsageRes, plansRes] = await Promise.all([
      fetch(`${dbUrl}/profiles?select=id,plan,industry,created_at&order=created_at.desc&limit=500${dateFilter}`, { headers }),
      fetch(`${dbUrl}/subscriptions?select=*&order=created_at.desc&limit=200${dateFilter}`, { headers }),
      fetch(`${dbUrl}/ai_usage_log?select=user_id,tokens_used,created_at&order=created_at.desc&limit=1000${dateFilter}`, { headers }),
      fetch(`${dbUrl}/plan_limits?select=*`, { headers }),
    ]);

    const [users, subscriptions, aiUsage, plans] = await Promise.all([
      usersRes.json() as Promise<Array<{ id: string; plan?: string; industry?: string; created_at?: string }>>,
      subRes.json() as Promise<Array<{ id: string; plan?: string; status?: string; amount?: number }>>,
      aiUsageRes.json() as Promise<Array<{ user_id?: string; tokens_used?: number }>>,
      plansRes.json() as Promise<Array<{ plan?: string; price?: number }>>,
    ]);

    // Compute metrics
    const totalUsers = Array.isArray(users) ? users.length : 0;
    const byPlan = Array.isArray(users) ? users.reduce((acc: Record<string, number>, u) => { acc[u.plan ?? "free"] = (acc[u.plan ?? "free"] ?? 0) + 1; return acc; }, {}) : {};
    const byIndustry = Array.isArray(users) ? users.reduce((acc: Record<string, number>, u) => { acc[u.industry ?? "unknown"] = (acc[u.industry ?? "unknown"] ?? 0) + 1; return acc; }, {}) : {};
    const activeSubscriptions = Array.isArray(subscriptions) ? subscriptions.filter((s) => s.status === "active").length : 0;
    const totalRevenue = Array.isArray(subscriptions) ? subscriptions.filter((s) => s.status === "active").reduce((sum, s) => sum + (s.amount ?? 0), 0) : 0;
    const totalTokens = Array.isArray(aiUsage) ? aiUsage.reduce((sum, a) => sum + (a.tokens_used ?? 0), 0) : 0;

    const dashboardData = {
      users: { total: totalUsers, by_plan: byPlan, by_industry: byIndustry },
      revenue: { active_subscriptions: activeSubscriptions, estimated_mrr: totalRevenue },
      ai_usage: { total_tokens: totalTokens, total_calls: Array.isArray(aiUsage) ? aiUsage.length : 0 },
      plans: Array.isArray(plans) ? plans : [],
    };

    if (mode !== "full" && mode !== "ai_usage" && mode !== "alerts") {
      res.json({ success: true, mode, data: dashboardData[mode as keyof typeof dashboardData] ?? dashboardData, ...meta });
      return;
    }

    // AI analysis
    const systemPrompt = `You are Jimmy, Sovereign Founder AI of HostFlow AI. Analyze these real business metrics and give the founder sharp, actionable intelligence. Be direct. Identify risks, opportunities, and exact next steps.`;
    const analysisPrompt = question
      ? `Business metrics:\n${JSON.stringify(dashboardData, null, 2)}\n\nFounder question: ${question}`
      : `Analyze these HostFlow AI business metrics and give me:\n1. Key wins\n2. Critical risks\n3. Top 3 immediate actions\n4. Revenue growth opportunities\n\nData:\n${JSON.stringify(dashboardData, null, 2)}`;

    const { response, provider } = await callJimmyAI(analysisPrompt, systemPrompt, false);

    res.json({
      success: true,
      mode,
      metrics: dashboardData,
      jimmy_analysis: response,
      provider,
      ...meta,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, ...meta });
  }
});

export default router;
