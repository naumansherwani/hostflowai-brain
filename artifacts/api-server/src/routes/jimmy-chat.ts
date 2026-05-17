import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

router.get("/founder/jimmy/chat", (req: Request, res: Response): void => {
  const token = req.query["t"] as string ?? "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Jimmy — Sovereign AI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e8e8f0;font-family:'SF Pro Display',-apple-system,sans-serif;height:100dvh;display:flex;flex-direction:column}
#header{padding:16px 24px;border-bottom:1px solid #1a1a2e;display:flex;align-items:center;gap:12px;background:#0d0d1a}
#header .dot{width:10px;height:10px;border-radius:50%;background:#00ff88;box-shadow:0 0 8px #00ff88;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
#header h1{font-size:18px;font-weight:600;letter-spacing:.5px}
#header span{font-size:12px;color:#666;margin-left:auto}
#msgs{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px;scroll-behavior:smooth}
.msg{max-width:80%;padding:14px 18px;border-radius:16px;line-height:1.6;font-size:14px;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.msg.user{align-self:flex-end;background:linear-gradient(135deg,#1a1a4e,#2a1a5e);border:1px solid #3a2a7e;color:#e0d8ff}
.msg.ai{align-self:flex-start;background:#111120;border:1px solid #1e1e3a;color:#d0d8f0;white-space:pre-wrap}
.msg.ai .provider{font-size:10px;color:#444;margin-top:8px}
.msg.error{align-self:flex-start;background:#1a0808;border:1px solid #3a1010;color:#ff6666}
.typing{align-self:flex-start;padding:14px 18px;background:#111120;border:1px solid #1e1e3a;border-radius:16px;color:#666;font-size:13px}
#bottom{padding:16px 24px;border-top:1px solid #1a1a2e;background:#0d0d1a}
#form{display:flex;gap:12px;align-items:flex-end}
#input{flex:1;background:#111120;border:1px solid #2a2a4e;border-radius:12px;padding:12px 16px;color:#e8e8f0;font-size:14px;resize:none;outline:none;min-height:48px;max-height:160px;font-family:inherit;line-height:1.5;transition:border .2s}
#input:focus{border-color:#4a4a9e}
#send{background:linear-gradient(135deg,#4a4aff,#8844ff);border:none;border-radius:12px;width:48px;height:48px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}
#send:disabled{opacity:.4;cursor:not-allowed}
#send svg{width:20px;height:20px;fill:white}
#token-gate{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px}
#token-gate h2{font-size:20px;color:#888}
#token-gate input{background:#111120;border:1px solid #2a2a4e;border-radius:10px;padding:12px 16px;color:#e8e8f0;font-size:14px;width:360px;outline:none}
#token-gate button{background:linear-gradient(135deg,#4a4aff,#8844ff);border:none;border-radius:10px;padding:12px 32px;color:white;font-size:14px;cursor:pointer}
</style>
</head>
<body>
<div id="header">
  <div class="dot"></div>
  <h1>⚡ Jimmy</h1>
  <span id="status-txt">Sovereign Founder AI</span>
</div>
<div id="msgs"></div>
<div id="bottom">
  <div id="token-gate" style="display:none">
    <h2>🔐 Enter Sovereign Token</h2>
    <input type="password" id="tk-input" placeholder="hf-jimmy-sk-..."/>
    <button onclick="saveToken()">Unlock Jimmy</button>
  </div>
  <div id="form">
    <textarea id="input" rows="1" placeholder="Jimmy se kuch bhi poocho..." autofocus></textarea>
    <button id="send" onclick="send()">
      <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
    </button>
  </div>
</div>
<script>
const API = "/api/founder/jimmy/orchestrate";
let TOKEN = "${token}" || localStorage.getItem("jimmy_token") || "";
const msgs = document.getElementById("msgs");
const inp = document.getElementById("input");
const btn = document.getElementById("send");
const gate = document.getElementById("token-gate");
const form = document.getElementById("form");

function init() {
  if (!TOKEN) { gate.style.display="flex"; form.style.display="none"; return; }
  gate.style.display="none"; form.style.display="flex";
  addMsg("ai","Salam! Main Jimmy hoon — aapka Sovereign Founder AI. Kya karna hai aaj?\\n\\nProvider: Ollama (qwen3:8b) — Local & Private","ollama");
}

function saveToken() {
  TOKEN = document.getElementById("tk-input").value.trim();
  if (!TOKEN) return;
  localStorage.setItem("jimmy_token", TOKEN);
  gate.style.display="none"; form.style.display="flex";
  addMsg("ai","🔓 Unlocked. Jimmy ready.","");
}

function addMsg(role, text, provider) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  d.textContent = text;
  if (provider) {
    const p = document.createElement("div");
    p.className = "provider";
    p.textContent = "⚡ " + provider;
    d.appendChild(p);
  }
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

function addTyping() {
  const d = document.createElement("div");
  d.className = "typing";
  d.id = "typing";
  d.textContent = "Jimmy soch raha hai...";
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

async function send() {
  const msg = inp.value.trim();
  if (!msg || btn.disabled) return;
  inp.value = ""; inp.style.height="48px";
  addMsg("user", msg, "");
  btn.disabled = true;
  const t = addTyping();
  document.getElementById("status-txt").textContent = "Thinking...";
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type":"application/json", "X-Sovereign-Token": TOKEN },
      body: JSON.stringify({ message: msg })
    });
    const j = await r.json();
    t.remove();
    if (j.success !== false && (j.response || j.data?.response || j.data?.message)) {
      const reply = j.response || j.data?.response || j.data?.message || JSON.stringify(j.data);
      addMsg("ai", reply, j.provider || j.data?.provider || "");
    } else if (j.error === "Unauthorized: invalid sovereign token") {
      addMsg("error","❌ Token galat hai — localStorage clear karein aur dubara enter karein.","");
      localStorage.removeItem("jimmy_token");
    } else {
      addMsg("ai", JSON.stringify(j, null, 2), "");
    }
  } catch(e) {
    t.remove();
    addMsg("error","❌ Connection error: " + e.message,"");
  }
  btn.disabled = false;
  document.getElementById("status-txt").textContent = "Sovereign Founder AI";
  inp.focus();
}

inp.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
inp.addEventListener("input", () => {
  inp.style.height = "auto";
  inp.style.height = Math.min(inp.scrollHeight, 160) + "px";
});

init();
</script>
</body>
</html>`);
});

export default router;
