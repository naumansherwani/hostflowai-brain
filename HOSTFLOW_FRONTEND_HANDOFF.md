# HostFlow AI — Complete Frontend Handoff for Replit

**Date:** May 12, 2026
**Owner:** Nauman Sherwani (naumansherwani@hostflowai.net, naumankhansherwani@gmail.com)
**Frontend stack:** React 18 + Vite 5 + Tailwind v3 + TypeScript 5
**Public domain:** https://hostflowai.net (canonical) · www.hostflowai.net
**Preview:** https://id-preview--0ac55503-220d-4481-83fe-d4e85a8e516e.lovable.app
**Lovable project ID:** 0ac55503-220d-4481-83fe-d4e85a8e516e
**Supabase project ref (Cloud-managed):** uapvdzphibxoomokahjh

This document is the **single, complete source of truth** for everything the
Lovable frontend ships. Nothing is hidden. Replit must honor the contracts
listed in §6–§12 — DB / auth / storage / email / frontend stay on Lovable
Cloud; AI brain / advisors / health / Polar webhooks stay on Replit.

---

## 1. Backend split (locked)

| Concern | Owner |
|---|---|
| Auth (Supabase JWT), DB of record, RLS, storage buckets, transactional email, all UI | **Lovable Cloud** |
| AI advisors (8 industries + Sherlock + Founder Adviser), health scores, benchmarks, plan-tier enforcement, deep workflow logic for healthcare/education/logistics | **Replit (HostFlow Brain)** |
| Polar checkout creation + webhooks + subscription grants | **Replit** (LIVE) |

Schema changes only via Lovable migrations. Do NOT auto-integrate Stripe /
Paddle / Lemon Squeezy on Lovable. Polar is the only payment provider.

---

## 2. Owner / Founder identity

Two emails, **both** treated as Owner / Admin / Founder class:

```
naumansherwani@hostflowai.net    (primary, custom-domain identity)
naumankhansherwani@gmail.com     (personal, gets notifications)
```

Frontend recognises them in `src/pages/Login.tsx` via `OWNER_EMAILS`. Both
trigger Crown badge, Founder OS access (`/founder`, `/owner`,
`/owner-crm`, `/admin/enterprise`, `/enterprise-console`), and the admin
"View-As-Plan" switcher.

`handle_new_user()` (DB trigger) seeds VIP lifetime premium for the
hostflowai.net mailbox. The personal Gmail is verified admin via
`user_roles` (already done).

Replit MUST: re-validate `has_role(user_id, 'admin')` server-side on every
admin-only call. Never trust the client.

---

## 3. Industries (8, locked)

`hospitality | airlines | car_rental | healthcare | education | logistics |
events_entertainment | railways`

Hospitality has TWO sub-types (`profiles.business_subtype`):
- `hotel_property` → rooms, occupancy, RevPAR, gap-night
- `travel_tours`   → packages, travelers, itineraries

**Never mix the two.** Replit must read `profiles.industry` and
`profiles.business_subtype` on every advisor / pricing / analytics call
and 403 on mismatch.

Per-industry feature gating (frontend already enforces in
`src/lib/industryFeatures.ts`):

| Feature | Industries |
|---|---|
| AI Smart Pricing | hospitality, airlines, car_rental, events_entertainment, railways |
| AI Ticket Generator / Email | airlines, railways, events_entertainment |
| Healthcare / Education / Logistics deep flows | Replit-owned, no pricing/ticketing |

Industry icons (`src/components/dashboard/IndustryIcon.tsx`):
hospitality→Globe (blue #2563eb), airlines→Plane, car_rental→Car,
healthcare→Hospital, education→GraduationCap, logistics→Truck/Package,
events_entertainment→Theater, railways→TrainFront.

---

## 4. Theming system (full detail)

### 4.1 Brand
- Primary teal: `hsl(168 70% 38%)` (also `#2DD4BF` in gradients)
- Secondary blue: `hsl(217 70% 52%)` (`#0F66EE`)
- Brand gradient: teal → deep blue
- Memory: `mem://design/brand-colors`

### 4.2 Industry-scoped tokens
`src/index.css` defines color tokens scoped by `[data-industry="X"]` on
`<html>` plus a paired dark variant `html.dark[data-industry="X"]`.
Every industry has its own palette covering: `--background`,
`--foreground`, `--card`, `--primary`, `--accent`, `--ring`,
`--sidebar-*`, plus the special `[data-industry="brand"]` (HostFlow teal).

### 4.3 How it's applied
`src/hooks/useWorkspaceTheme.tsx` runs inside `AppLayout` and sets
`document.documentElement.dataset.industry` from
`activeWorkspace.industry || profile.industry`. **Fallback is `"brand"`**
so the owner / admin never sees an un-themed grey shell on first login
(fixed May 12, 2026).

User can pick mode via Settings → Theme: `industry | brand | system`.
Persisted under `localStorage["hostflow_workspace_theme_mode"]`.
Only cleared when the user navigates fully out of the app shell.

### 4.4 Dark / light
- `ThemeToggle` component flips `html.dark` and persists
  `localStorage["theme"]`.
- `color-scheme: light dark` set on `<html>` so native form / scrollbar
  colors track the active mode.
- Each industry block has matching `:root` (light) and `html.dark[...]`
  (dark) variants — no token is left undefined in either mode.

### 4.5 Founder OS sub-theme
`src/components/founder/FounderTheme.tsx` wraps Founder pages with its
own `data-founder-theme="dark|light"` palette (gold accents on dark
glass). Independent from the industry/brand toggle so the owner can
keep the customer-facing dashboard in industry colors AND the Founder
console in luxe-dark.

---

## 5. Identity layer — Neural Halo

Single primitive: `src/components/identity/UserHalo.tsx`. Used wherever
the user shows up (header, advisor chat, founder header, etc.).

- Pulls private avatar from `profile-avatars` Supabase bucket via
  `useAvatarSignedUrl` (1-hour signed URLs, auto-refresh).
- Industry-themed halo color from `advisorConfig.ts`.
- 4 pulse states: `idle | streaming | sherlock | resolved`.
- Optional `founderBadge={true}` overlays Crown for owner.
- Profile upload writes to private bucket + saves `profiles.avatar_path`
  (legacy `avatar_url` kept for back-compat).

Memory: `mem://features/neural-halo-identity`.

---

## 6. Auth contract Replit must honor

Every browser → Replit call carries:

```
Authorization: Bearer <supabase_access_token>
X-HostFlow-Surface: dashboard | crm    (when relevant)
X-View-As-Plan:    basic | standard | premium   (admin override only)
```

Replit MUST:
1. `supabase.auth.getUser(token)` to resolve `user.id`.
2. `has_role(user.id, 'admin')` before honoring `X-View-As-Plan`. If not
   admin → ignore the header, fall back to real plan from `subscriptions`.
3. Tag usage logs with `view_as_plan` when honored, so QA doesn't pollute
   MRR / churn analytics.
4. Anonymous sign-ups are disabled. Email verification required.
5. Auth providers enabled: Email, Google, Apple.

---

## 7. Plan enforcement (Replit owns)

Tiers (frontend display in `src/lib/pricingConfig.ts`):

| UI plan | Header value | DB plan column | Price |
|---|---|---|---|
| Trial | n/a | `trial` | free, 3 days |
| Basic | `basic` | `basic` | $15/mo |
| Standard | `standard` | `pro` (legacy) | $39/mo |
| Premium | `premium` | `premium` | $99/mo |

For every limited feature Replit must:
1. Read `subscriptions.plan` (or honor `X-View-As-Plan` if admin).
2. Read `plan_feature_limits` for `(plan, feature_key)`.
3. Read `feature_usage` for `(user_id, feature_key)`.
4. `is_unlimited=true` → ALLOW. Else `usage >= limit` →
   `429 { error: "AI_LIMIT_REACHED", upgrade_to }`.
5. Else ALLOW + atomic increment.
6. Daily reset 00:00 UTC, monthly reset 1st UTC.

---

## 8. SSE advisor contract

`POST /api/advisor/:industry`
`Accept: text/event-stream`

Replit yields events:
`start | chunk | done | escalation | error`

Frontend wrapper: `src/lib/replitApi.ts` → `replitStream()` (forwards
auth + surface + view-as-plan headers automatically).

Validate `:industry` matches `profiles.industry` (and sub-type for
hospitality). 403 on mismatch.

Standard JSON envelope for non-stream calls:
```json
{ "ok": true, "data": ..., "error": { "code", "message" }, "trace_id" }
```

---

## 9. CORS & domains

Whitelist on Replit:
```
https://hostflowai.net
https://www.hostflowai.net
https://*.lovable.app          (preview + published subdomains)
http://localhost:5173          (dev only)
```
Allow methods: `GET, POST, OPTIONS`. Allow headers: `Authorization,
Content-Type, X-HostFlow-Surface, X-View-As-Plan, Accept`.

---

## 10. Replit route map (mirrors what `invokeShim` already calls)

| Legacy edge name | Replit route | Method |
|---|---|---|
| crm-ai-assistant / crm-daily-planner / crm-performance-report | /api/advisor/:industry | POST (SSE) |
| ai-smart-pricing | /api/pricing/suggest | POST |
| ai-auto-schedule | /api/calendar/suggest | POST |
| validate-booking | /api/bookings | POST |
| ai-onboarding-guide | /api/onboarding/answer | POST |
| founder-adviser | /api/founder/adviser | POST (SSE) |
| founder-intelligence / mrr-ai-insights | /api/intelligence-reports/latest | GET |
| owner-email-ai | /api/email | POST |
| owner-mailbox | /api/email/inbox | GET |
| churn-risk-score | /api/health-scores/admin | GET |
| retention-action | /api/health-scores/admin/critical | GET |
| arc-event-ingest | /api/v1/sync-manifest | POST |
| arc-orchestrator | /api/signals | POST |
| contact-form | /api/email/contact | POST |

---

## 11. Database schema Replit reads (read-only from Replit; mutations only via Lovable migrations)

Critical tables Replit consumes:
- `profiles` (industry, business_subtype, avatar_path, company_name, country)
- `user_roles` (admin / user enum)
- `subscriptions` (plan, status, trial_ends_at, current_period_end, is_lifetime)
- `plan_feature_limits` (plan, feature_key, limit_count, is_unlimited, reset_period)
- `feature_usage` (user_id, feature_key, usage_count, period_start)
- `workspaces` (multi-industry support)
- `bookings`, `railway_bookings`, `flight_bookings`, `vehicle_bookings`,
  `healthcare_appointments`, `education_classes`, `logistics_shipments`,
  `events`, `tickets` — all RLS-protected.
- `crm_*` tables (contacts, deals, activities, tasks, ai_insights,
  performance, security_alerts, activity_logs)
- `admin_alerts`, `intelligence_reports`, `health_scores`,
  `founder_ai_conversations`, `founder_ai_messages`
- `email_queue`, `email_log`, `email_suppression`

DB functions Replit may call: `has_role`, `has_active_subscription`,
`has_lifetime_access`, `get_launch_discount_status`, `enqueue_email`.

---

## 12. Storage buckets

| Bucket | Public? | Purpose |
|---|---|---|
| avatars | Public | legacy display avatars |
| profile-avatars | **Private** | new Neural Halo avatars (signed URLs, 1h) |
| advisor-attachments | Private | advisor file uploads |
| founder-ai-uploads | Private | Founder AI uploads |

---

## 13. Frontend file map (every meaningful surface)

### Layouts & shell
- `src/components/app/AppLayout.tsx` — main authed shell, header, theme bootstrap, view-as-plan banner, halo, public-view toggle (Ctrl+Shift+P).
- `src/components/app/AppSidebar.tsx`, `GhostSidebar.tsx` — navigation rails.
- `src/components/app/PlanSwitcher.tsx` — admin View-As-Plan control.
- `src/components/app/PublicView.tsx` — industry chooser overlay.
- `src/components/founder/FounderLayout.tsx` + `FounderTheme.tsx` + `FounderSidebar.tsx` + `FounderHeader.tsx` — Founder OS shell.
- `src/components/auth/ProtectedRoute.tsx` + `AdminRoute.tsx` — route guards.
- `src/components/SurfaceGuard.tsx` — feature-availability gate.

### Pages (`src/pages/`)
Public: `Index, About, Contact, Pricing, PrivacyPolicy, Terms, RefundPolicy, Login, Signup, ForgotPassword, ResetPassword, Maintenance, Unsubscribe, NotFound, CheckoutSuccess, CheckoutCancelled`.
Authed: `Dashboard, CRM, Analytics, AIAdvisor, RevenueIntelligence, ResolutionHubPage, Automations, Integrations, Billing, Support, Earnings, Messages, Reviews, Settings, Profile, Onboarding, RailwayDashboard`.
Admin / Founder: `OwnerConsole, EnterpriseConsole, FounderOS`.

### Dashboard widgets (`src/components/dashboard/`)
StatsCards, IndustryKPIs, IndustryWidgets, AIAutoSchedule, AddBookingDialog, AlertsPanel, AutoPricingPanel, BookingCalendar, BookingManager, BookingsList, AirlineOperationsDashboard, AirlineWidgets, AirlineAIResolveDialog, CarRentalWidgets, EventsManager, EventsWidgets, EducationWidgets, FleetIntelligence, FlightManager, GapNightFiller, GuestScoreCard, HealthcareManager, HealthcareWidgets, LogisticsManager, LogisticsWidgets, PriceAlertsPanel, ResolutionHub, ResourceManager, ScheduleSettingsPanel, ScheduleTimeline, SmartCalendarView, SmartPricingCard, TimetableManager, TravelWidgets, TurnoverProfit, UsageCard, VehicleManager, WorkspaceSwitcher, WorkspaceSlidePanel, IndustryChooser, IndustrySwitcher, IndustryIcon, AddIndustryDialog, EmptyWorkspaceState, CompetitorRadar, DoubleBookingGuard, HowItWorksGuide.

### CRM (`src/components/crm/`)
Tabs: Contacts, Deals, Activities, Tickets, Performance, AiInsights. Plus: ContactDetailPanel, AdminPanel, AiEmailComposer, BreakGames, CompetitorIntelligence, DailyPlanPanel, FlightOpsCalendar, GoogleSyncPanel, GreetingBar, IndustryConnect, LiveKPIs, PredictiveRevenue, QuickActions, RevenueChart, SecurityPanel, SentimentDashboard, SmartMeetingScheduler, TasksPanel, ToolPanel, VoiceAssistant, WeatherWidget, WidgetsPanel, WorkTimer, WhatsAppConnect.

### Enterprise CRM (`src/components/enterprise-crm/`)
EntDashboard, EntCompanies, EntLeads, EntLeadDetailSheet, EntPipeline, EntTasks, EntNotes, EntAnalytics — admin-only enterprise pipeline.

### Founder OS (`src/components/founder/sections/`)
Full executive console: KPIs, MRR insights, churn, advisor brain, mailbox, schedule, command center.

### Conversion / monetisation
`FeatureGate, UpgradeNudge, LimitReachedPopup, CheckoutRescuePopup, FirstSuccessMessage, SmartEmptyState, AiLimitModal, TrialBanner, PaymentsResumingBanner, CookieConsent`.

### Identity & advisor
`identity/UserHalo`, `advisor/FloatingAdvisorChat`, `advisor/advisorConfig`, `AiGuideChatbot`.

### Industry-specific (railway)
`src/components/railway/*` — full Railways operations module (routes, trains, coaches, schedule, bookings, pricing, notifications, stats).

### Voice / TTS / chat
`hooks/useWelcomeAudio`, `chat/ChatSpeakerButton` (ElevenLabs via edge functions `elevenlabs-conversation-token`, `elevenlabs-tts`).

### Reviews / retention
`reviews/AdminReviewsPanel, ReviewCard, ReviewForm`, `retention/RetentionWizard`, `winback/WinBackOfferModal`.

### i18n (`src/i18n/`)
15 locales: en, es, fr, de, de-CH, it, pt, ar, hi, ja, ko, ro, tr, ur, zh.

### Hooks (`src/hooks/`)
useAuth, useProfile, useWorkspaces, useWorkspaceTheme, useSubscription, useTrialLimits, usePlanLimits, useViewAsPlan, useCurrency, useAvatarSignedUrl, useCrm, useCrmTasks, useCrmActivityLogger, useCrmPerformance, useCrmSecurity, useEnterpriseCrm, useAgentInbox, useAiPricing, useArcTracking, useConversationCap, useEvents, useFounderMetrics, useHealthcare, useLogistics, useOwnerMailbox, useResolutionHubCount, useWelcomeAudio, use-mobile, use-toast.

### Lib (`src/lib/`)
api, backend, brain-sync, bookingStore, checkoutTracking, crmConfig, handleApiError, industryConfig, industryFeatures, ownerNotifications, pricingConfig, replitApi, replitAuth, replitBase, replitInbox, utils.

### Edge functions (Lovable Cloud — supabase/functions/)
ai-auto-schedule, ai-guide-chat, ai-onboarding-guide, ai-smart-pricing, arc-event-ingest, arc-orchestrator, churn-risk-score, contact-form, crm-ai-assistant, crm-daily-planner, crm-performance-report, elevenlabs-conversation-token, elevenlabs-tts, exit-survey-summary, founder-action-execute, founder-adviser, founder-adviser-title, founder-intelligence, founder-weekly-report, handle-email-suppression, handle-email-unsubscribe, mrr-ai-insights, owner-email-ai, owner-mailbox, owner-password-recovery, owner-schedule-dispatch, polar-create-checkout, polar-webhook, preview-transactional-email, process-email-queue, resend-send, resolve-schedule-conflict, retention-action, review-ai-filter, send-transactional-email, update-translations, validate-booking, winback-approve-offer, winback-generate-offer.

These edge functions exist for Cloud-side concerns (email queue, Polar
checkout creation, ElevenLabs token issuance, password recovery, etc.).
The AI brain endpoints (`crm-ai-assistant`, `founder-adviser`,
`ai-smart-pricing`, etc.) are **shimmed via `invokeShim`** to forward to
Replit when available, and only fall back to local edge fn if Replit is
down.

---

## 14. Frontend rules Replit must respect

1. **No mock data** anywhere in dashboard / workspace / founder UI. Owner sees exactly what a paying user sees. Sample data only on `/demo`.
2. **Industry isolation** strict — never cross-mix data between industries or hospitality sub-types.
3. **Sherlock is hidden from customers** — only surfaces in Founder OS / admin contexts.
4. **Mood detection** is opt-in, future-only.
5. **No public support@ email** anywhere on marketing pages — only internal founder mailbox identity exists.
6. **No "Book Demo" CTA** on landing/pricing.
7. **Dark theme + Apple-minimal aesthetic** is the design north star.

---

## 15. Recent fixes (May 12, 2026)

- `useWorkspaceTheme` cleanup bug: was clearing `data-industry` on every workspace/profile change → caused a one-frame un-themed flicker (the "glitch" + "default colors not appearing" the owner reported). Fixed: cleanup now runs only on full unmount, and fallback is `"brand"` instead of nothing.
- Hospitality globe icon recolored teal → blue (`#2563eb`) so it reads as "world / global" not as brand teal.
- Top-bar buttons unified on subtle teal accent (`hsl(168 70% 38%)`) with white-on-hover.
- Owner Login (`src/pages/Login.tsx`) now recognizes BOTH owner emails for Crown / Founder access.

---

## 16. TL;DR for Replit

1. Validate Supabase JWT on every request. Re-check admin role server-side.
2. Honor `X-HostFlow-Surface` and `X-View-As-Plan` headers exactly as documented.
3. Read `profiles.industry` + `profiles.business_subtype` on every advisor/pricing/analytics call. 403 on mismatch.
4. Enforce plan caps via `plan_feature_limits` + `feature_usage`. Return `429 AI_LIMIT_REACHED` when exceeded.
5. Stream advisor responses as SSE with `start|chunk|done|escalation|error`.
6. Own Polar checkout + webhooks. Lovable does NOT touch any payment provider.
7. Never mutate Supabase schema directly — request a Lovable migration.
8. CORS-allow `hostflowai.net`, `www.hostflowai.net`, `*.lovable.app`.

End of handoff. This file is in `/mnt/documents/HOSTFLOW_FRONTEND_HANDOFF.md` — download from the artifact card.
