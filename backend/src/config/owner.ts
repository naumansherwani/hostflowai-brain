// ─────────────────────────────────────────────────────────────────────────────
// OWNER PROTOCOL — Single source of truth for founder identity
// Muhammad Nauman Sherwani — HostFlow AI Founder
// Tiger + Sherlock = Two Rulers of HostFlow AI
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER_CONFIG = {
  email: "naumansherwani@hostflowai.net",
  name: "Mr. Nauman Sherwani",
  greeting: "👑 Welcome Back, Mr. Nauman Sherwani",
  notification_email: "naumankhansherwani@gmail.com",
  unlimited_ai: true,
  bypass_plan_limits: true,
  bypass_rate_limits: true,
  force_premium_features: true,
} as const;

export function isOwnerEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.toLowerCase() === OWNER_CONFIG.email.toLowerCase();
}
