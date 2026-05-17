import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const router: IRouter = Router();

function sovereignAuth(req: Request, res: Response, next: () => void): void {
  const provided = (req.headers["x-sovereign-token"] ?? "").toString().trim();
  const expected = (process.env["FOUNDER_SECRET_KEY"] ?? "").trim();
  if (!expected || provided !== expected) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: invalid sovereign token",
    });
    return;
  }
  next();
}

async function loadJimmyIdentity(): Promise<Record<string, unknown> | null> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("jimmy_absolute_core")
    .select("*")
    .eq("active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function callOllama(prompt: string, systemPrompt: string): Promise<string> {
  const ollamaUrl = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
  const model = process.env["JIMMY_MODEL"] ?? "qwen3:8b";

  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { message?: { content?: string } };
  return json.message?.content ?? "";
}

async function callGemini(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callGroq(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

router.post(
  "/founder/jimmy/orchestrate",
  (req: Request, res: Response, next: () => void) => sovereignAuth(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const audit_id = randomUUID();

    const {
      message,
      use_burst = false,
      context = {},
    } = req.body as {
      message?: string;
      use_burst?: boolean;
      context?: Record<string, unknown>;
    };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: "message is required",
        audit_id,
      });
      return;
    }

    try {
      const identity = await loadJimmyIdentity();

      const systemPrompt = identity
        ? `You are Jimmy, the Founder AI of HostFlow AI.

Identity: ${identity["name"] ?? "Jimmy"}
Role: ${identity["role"] ?? "Founder AI Orchestrator"}
Mission: ${identity["mission"] ?? "Build and operate HostFlow AI as a sovereign AI OS"}
Principles: ${JSON.stringify(identity["principles"] ?? [])}
Domain: ${identity["domain"] ?? "AI business automation"}

Context provided: ${JSON.stringify(context)}

You think strategically, act decisively, and respond with structured clarity. You are the internal AI brain of the founder — sovereign, precise, and always aligned with business goals.`
        : `You are Jimmy, the Founder AI of HostFlow AI — a sovereign AI orchestrator. You help the founder make decisions, analyze business data, and orchestrate actions across the platform.`;

      let response = "";
      let provider = "ollama";

      const geminiKey = process.env["GEMINI_API_KEY"];
      const groqKey = process.env["GROQ_API_KEY"];

      if (use_burst && geminiKey) {
        // Burst mode: Gemini first (fastest, smartest)
        try {
          response = await callGemini(message.trim(), systemPrompt);
          provider = "gemini";
        } catch {
          try {
            if (groqKey) {
              response = await callGroq(message.trim(), systemPrompt);
              provider = "groq";
            } else {
              response = await callOllama(message.trim(), systemPrompt);
              provider = "ollama";
            }
          } catch {
            throw new Error("All burst providers failed");
          }
        }
      } else if (use_burst && groqKey) {
        try {
          response = await callGroq(message.trim(), systemPrompt);
          provider = "groq";
        } catch {
          response = await callOllama(message.trim(), systemPrompt);
          provider = "ollama";
        }
      } else {
        // Default: try Ollama first, auto-fallback to Gemini → Groq
        try {
          response = await callOllama(message.trim(), systemPrompt);
          provider = "ollama";
        } catch {
          // Ollama not available — auto-fallback
          if (geminiKey) {
            try {
              response = await callGemini(message.trim(), systemPrompt);
              provider = "gemini-fallback";
            } catch {
              if (groqKey) {
                response = await callGroq(message.trim(), systemPrompt);
                provider = "groq-fallback";
              } else {
                throw new Error("Ollama unavailable and no API keys configured (GEMINI_API_KEY / GROQ_API_KEY)");
              }
            }
          } else if (groqKey) {
            response = await callGroq(message.trim(), systemPrompt);
            provider = "groq-fallback";
          } else {
            throw new Error("Ollama unavailable and no API keys configured (GEMINI_API_KEY / GROQ_API_KEY)");
          }
        }
      }

      res.json({
        success: true,
        response,
        provider,
        audit_id,
        actions: [],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({
        success: false,
        error: `Jimmy orchestration failed: ${msg}`,
        audit_id,
      });
    }
  }
);

export default router;
