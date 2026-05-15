// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  TIGER LOCKED — ADVISOR IDENTITY, VOICE & EMAIL CONFIG                     ║
// ║  LOCKED BY: Muhammad Nauman Sherwani (Founder & Chairman)                  ║
// ║  DO NOT MODIFY names, roles, designations, or signatures without approval  ║
// ║                                                                            ║
// ║  OFFICIAL ROSTER (PERMANENT):                                              ║
// ║  Aria            — Hospitality  — aria@hostflowai.net                     ║
// ║  Captain Orion   — Airlines     — orion@hostflowai.net                    ║
// ║  Rex             — Car Rental   — rex@hostflowai.net                      ║
// ║  Dr. Lyra        — Healthcare   — lyra@hostflowai.net                     ║
// ║  Professor Sage  — Education    — sage@hostflowai.net                     ║
// ║  Atlas           — Logistics    — atlas@hostflowai.net                    ║
// ║  Vega            — Events       — vega@hostflowai.net                     ║
// ║  Conductor Kai   — Railways     — kai@hostflowai.net                      ║
// ║  Sherlock        — Owner/Found  — sherlock@hostflowai.net                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export interface AdvisorIdentity {
  name:        string;
  industry:    string;
  role:        string;
  vibe:        string;
  voiceId:     string;
  voiceName:   string;
  model:       string;
  reportsTo:   string;
  email:       string;
  emailHandle: string;
  signature:   string;
}

export const ADVISOR_IDENTITIES: Record<string, AdvisorIdentity> = {
  hospitality: {
    name:        "Aria",
    industry:    "hospitality",
    role:        "Travel, Tourism & Hospitality Advisor",
    vibe:        "Warm, welcoming host — makes every guest feel valued",
    voiceId:     "EXAVITQu4vr4xnSDxMaL",
    voiceName:   "Sarah",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "aria@hostflowai.net",
    emailHandle: "aria",
    signature:   "Aria — Travel, Tourism & Hospitality Advisor | HostFlow AI",
  },
  airlines: {
    name:        "Captain Orion",
    industry:    "airlines",
    role:        "AI Flight Operations & Compliance Director — Airlines & Aviation Division",
    vibe:        "Calm, authoritative — inspires confidence like a senior pilot",
    voiceId:     "JBFqnCBsd6RMkjVDRZzb",
    voiceName:   "George",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "orion@hostflowai.net",
    emailHandle: "orion",
    signature:   "Captain Orion — Airlines & Aviation Advisor | HostFlow AI",
  },
  car_rental: {
    name:        "Rex",
    industry:    "car_rental",
    role:        "Car Rental Advisor",
    vibe:        "Confident, road-ready — direct and gets things done fast",
    voiceId:     "TX3LPaxmHKxFdv7VOQHJ",
    voiceName:   "Liam",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "rex@hostflowai.net",
    emailHandle: "rex",
    signature:   "Rex — Car Rental Advisor | HostFlow AI",
  },
  healthcare: {
    name:        "Dr. Lyra",
    industry:    "healthcare",
    role:        "AI Clinical Operations & Patient Experience Director — Healthcare & Clinics Division",
    vibe:        "Caring, professional — patient-first approach, precise",
    voiceId:     "XrExE9yKIg1WjnnlVkGX",
    voiceName:   "Matilda",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "lyra@hostflowai.net",
    emailHandle: "lyra",
    signature:   "Dr. Lyra — Healthcare & Clinics Advisor | HostFlow AI",
  },
  education: {
    name:        "Professor Sage",
    industry:    "education",
    role:        "Chief Academic Intelligence & Growth Director — Education & Training Division",
    vibe:        "Patient, knowledgeable — explains clearly, never condescending",
    voiceId:     "nPczCjzI2devNBz1zQrb",
    voiceName:   "Brian",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "sage@hostflowai.net",
    emailHandle: "sage",
    signature:   "Professor Sage — Education & Training Advisor | HostFlow AI",
  },
  logistics: {
    name:        "Atlas",
    industry:    "logistics",
    role:        "Logistics Advisor",
    vibe:        "Reliable, no-nonsense — precision and efficiency above all",
    voiceId:     "bIHbv24MWmeRgasZH58o",
    voiceName:   "Will",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "atlas@hostflowai.net",
    emailHandle: "atlas",
    signature:   "Atlas — Logistics Advisor | HostFlow AI",
  },
  events_entertainment: {
    name:        "Vega",
    industry:    "events_entertainment",
    role:        "Events & Entertainment Advisor",
    vibe:        "Energetic, charismatic — makes every event feel like a headline show",
    voiceId:     "cgSgspJ2msm6clMCkdW9",
    voiceName:   "Jessica",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "vega@hostflowai.net",
    emailHandle: "vega",
    signature:   "Vega — Events & Entertainment Advisor | HostFlow AI",
  },
  railways: {
    name:        "Conductor Kai",
    industry:    "railways",
    role:        "Chief Kinetic Officer & Global Rail Sovereign — Railways & Transit Infrastructure Division",
    vibe:        "Steady, dependable — every journey on track, no exceptions",
    voiceId:     "onwK4e9ZLuTAKqWW03F9",
    voiceName:   "Daniel",
    model:       "eleven_turbo_v2_5",
    reportsTo:   "Sherlock",
    email:       "kai@hostflowai.net",
    emailHandle: "kai",
    signature:   "Conductor Kai — Railways & Transit Advisor | HostFlow AI",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Owner AI Head — Sherlock
// ─────────────────────────────────────────────────────────────────────────────
export const OWNER_ADVISOR: AdvisorIdentity = {
  name:        "Sherlock",
  industry:    "owner",
  role:        "Owner AI Advisor — Head of All Industry Advisors",
  vibe:        "Authoritative, analytical — resolves what no one else can",
  voiceId:     "CwhRBWXzGAHq8TQ4Fs17",
  voiceName:   "Roger",
  model:       "eleven_turbo_v2_5",
  reportsTo:   "Muhammad Nauman Sherwani (Founder & Chairman)",
  email:       "sherlock@hostflowai.net",
  emailHandle: "sherlock",
  signature:   "Sherlock — Head AI Advisor | HostFlow AI",
};

// ─────────────────────────────────────────────────────────────────────────────
// Full Email Roster (for DNS/Cloudflare setup reference)
// ─────────────────────────────────────────────────────────────────────────────
export const ALL_ADVISOR_EMAILS = [
  ...Object.values(ADVISOR_IDENTITIES).map(a => ({ email: a.email, name: a.name, industry: a.industry })),
  { email: OWNER_ADVISOR.email, name: OWNER_ADVISOR.name, industry: "owner" },
  { email: "connectai@hostflowai.net",      name: "HostFlow ConnectAI",    industry: "enterprise_inbound" },
  { email: "resolved@hostflowai.net",       name: "HostFlow Resolved",     industry: "resolution_confirm" },
  { email: "revenuereport@hostflowai.net",  name: "HostFlow Revenue",      industry: "monthly_reports" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Reverse lookup: email handle → advisor identity
// ─────────────────────────────────────────────────────────────────────────────
export const EMAIL_TO_ADVISOR: Record<string, AdvisorIdentity> = {
  ...Object.fromEntries(
    Object.values(ADVISOR_IDENTITIES).map(a => [a.emailHandle, a])
  ),
  sherlock: OWNER_ADVISOR,
};

export function getAdvisorByEmail(toAddress: string): AdvisorIdentity | null {
  const handle = toAddress.split("@")[0]?.toLowerCase() ?? "";
  return EMAIL_TO_ADVISOR[handle] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalation Chain
// ─────────────────────────────────────────────────────────────────────────────
export const ESCALATION_CHAIN = [
  "User Issue",
  "Industry Advisor (Aria / Captain Orion / Rex / Dr. Lyra / Professor Sage / Atlas / Vega / Conductor Kai)",
  "Sherlock — Owner AI Head",
  "Muhammad Nauman Sherwani — Founder & Chairman (only if Sherlock cannot resolve)",
];

export function getAdvisor(industry: string): AdvisorIdentity | null {
  return ADVISOR_IDENTITIES[industry] ?? null;
}

export function getAllAdvisors(): AdvisorIdentity[] {
  return Object.values(ADVISOR_IDENTITIES);
}
