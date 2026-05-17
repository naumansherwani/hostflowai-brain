import { type Request, type Response } from "express";
import { randomUUID } from "crypto";

export function sovereignAuth(req: Request, res: Response, next: () => void): void {
  const token = req.headers["x-sovereign-token"];
  const expected = process.env["FOUNDER_SECRET_KEY"];
  if (!expected || token !== expected) {
    res.status(401).json({ success: false, error: "Unauthorized: invalid sovereign token", audit_id: randomUUID() });
    return;
  }
  next();
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
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
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
  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function callJimmyAI(
  prompt: string,
  systemPrompt: string,
  useBurst = false
): Promise<{ response: string; provider: string }> {
  const geminiKey = process.env["GEMINI_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];

  if (useBurst && geminiKey) {
    try {
      return { response: await callGemini(prompt, systemPrompt), provider: "gemini" };
    } catch {
      if (groqKey) {
        return { response: await callGroq(prompt, systemPrompt), provider: "groq" };
      }
    }
  }

  if (useBurst && groqKey) {
    try {
      return { response: await callGroq(prompt, systemPrompt), provider: "groq" };
    } catch { /* fall through */ }
  }

  try {
    return { response: await callOllama(prompt, systemPrompt), provider: "ollama" };
  } catch {
    if (geminiKey) {
      try {
        return { response: await callGemini(prompt, systemPrompt), provider: "gemini-fallback" };
      } catch { /* fall through */ }
    }
    if (groqKey) {
      return { response: await callGroq(prompt, systemPrompt), provider: "groq-fallback" };
    }
    throw new Error("All AI providers unavailable. Add GEMINI_API_KEY or GROQ_API_KEY to .env");
  }
}
