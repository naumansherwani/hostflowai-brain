import { type Request, type Response } from "express";
import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Jimmy AI Core — Single key, all endpoints auto-active
// Provider order: Ollama (primary) → OpenAI → Gemini → Groq
// ─────────────────────────────────────────────────────────────────────────────

export function sovereignAuth(req: Request, res: Response, next: () => void): void {
  const token = req.headers["x-sovereign-token"];
  const expected = process.env["FOUNDER_SECRET_KEY"];
  if (!expected || token !== expected) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: invalid sovereign token",
      audit_id: randomUUID(),
    });
    return;
  }
  next();
}

// ─── Providers ────────────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
  const json = await res.json() as { message?: { content?: string } };
  return json.message?.content ?? "";
}

async function callOpenAI(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  const model = process.env["JIMMY_OPENAI_MODEL"] ?? "gpt-4o-mini";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
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
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callGroq(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

// ─── Provider health check ────────────────────────────────────────────────────

export async function checkOllamaHealth(): Promise<{ ok: boolean; model: string; url: string }> {
  const ollamaUrl = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
  const model = process.env["JIMMY_MODEL"] ?? "qwen3:8b";
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, model, url: ollamaUrl };
    const json = await res.json() as { models?: Array<{ name: string }> };
    const models = json.models?.map(m => m.name) ?? [];
    const loaded = models.some(n => n.startsWith(model.split(":")[0]!));
    return { ok: loaded, model: loaded ? model : `${model} (not pulled — run: ollama pull ${model})`, url: ollamaUrl };
  } catch {
    return { ok: false, model, url: ollamaUrl };
  }
}

export function getAvailableProviders(): string[] {
  const p: string[] = [];
  p.push("ollama");
  if (process.env["OPENAI_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]) p.push("openai");
  if (process.env["GEMINI_API_KEY"]) p.push("gemini");
  if (process.env["GROQ_API_KEY"]) p.push("groq");
  return p;
}

// ─── Main AI router — Ollama primary, auto-fallback chain ────────────────────

export async function callJimmyAI(
  prompt: string,
  systemPrompt: string,
  useBurst = false
): Promise<{ response: string; provider: string }> {
  const providers: Array<{ name: string; fn: () => Promise<string> }> = [];

  if (useBurst) {
    // Burst: OpenAI → Gemini → Groq → Ollama
    if (process.env["OPENAI_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENAI_API_KEY"])
      providers.push({ name: "openai", fn: () => callOpenAI(prompt, systemPrompt) });
    if (process.env["GEMINI_API_KEY"])
      providers.push({ name: "gemini", fn: () => callGemini(prompt, systemPrompt) });
    if (process.env["GROQ_API_KEY"])
      providers.push({ name: "groq", fn: () => callGroq(prompt, systemPrompt) });
  }

  // Ollama always in chain (primary for standard, last resort for burst)
  providers.push({ name: "ollama", fn: () => callOllama(prompt, systemPrompt) });

  // If burst requested but no cloud keys, add cloud as fallbacks after ollama
  if (useBurst && providers.length === 1) {
    if (process.env["GEMINI_API_KEY"])
      providers.push({ name: "gemini-fallback", fn: () => callGemini(prompt, systemPrompt) });
    if (process.env["GROQ_API_KEY"])
      providers.push({ name: "groq-fallback", fn: () => callGroq(prompt, systemPrompt) });
  }

  const errors: string[] = [];
  for (const { name, fn } of providers) {
    try {
      const response = await fn();
      return { response, provider: name };
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  throw new Error(`All Jimmy AI providers failed:\n${errors.join("\n")}`);
}
