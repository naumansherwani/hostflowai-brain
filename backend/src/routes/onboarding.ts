// ─────────────────────────────────────────────────────────────────────────────
// AI Onboarding Intelligence — 5-Minute Setup
// Advisor asks 5 targeted questions on first session.
// Answers feed customer_360_profiles and unlock personalized KPI dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/jwt.js";
import { requireSurface } from "../middleware/require-surface.js";
import { ok, err } from "../lib/response.js";

const router = Router();

// Industry-specific onboarding questions
const ONBOARDING_QUESTIONS: Record<string, Array<{ slug: string; question: string; type: string; hint?: string }>> = {
  hospitality: [
    { slug: "business_size",        question: "How many rooms, properties, or tours do you operate?",       type: "text",   hint: "e.g. 12 rooms / 3 properties / 50 tours/month" },
    { slug: "biggest_pain",         question: "What is your single biggest operational headache right now?", type: "text",   hint: "e.g. double bookings, low occupancy, OTA commission costs" },
    { slug: "channels",             question: "Which booking channels are you currently on?",               type: "text",   hint: "e.g. Booking.com, Airbnb, Direct, Expedia" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",            type: "choice", hint: "Under £5k / £5k–£20k / £20k–£50k / £50k+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",                type: "text",   hint: "e.g. increase occupancy by 15%, reduce no-shows" },
  ],
  airlines: [
    { slug: "fleet_size",           question: "How many aircraft are in your fleet?",                      type: "text",   hint: "e.g. 12 aircraft" },
    { slug: "biggest_pain",         question: "What is your single biggest operational challenge right now?",type: "text",  hint: "e.g. crew scheduling, delay management, low load factor" },
    { slug: "gds_channels",         question: "Which GDS / distribution channels do you use?",             type: "text",   hint: "e.g. Amadeus, Sabre, Travelport, Direct" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",            type: "choice", hint: "Under $50k / $50k–$200k / $200k–$1M / $1M+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",                type: "text",   hint: "e.g. improve OTP to 90%, increase load factor by 8%" },
  ],
  car_rental: [
    { slug: "fleet_size",           question: "How many vehicles are in your fleet?",                      type: "text",   hint: "e.g. 45 vehicles" },
    { slug: "biggest_pain",         question: "What is your single biggest operational headache?",         type: "text",   hint: "e.g. low utilization, damage claims, peak pricing" },
    { slug: "channels",             question: "How do customers book with you?",                           type: "text",   hint: "e.g. Direct website, Expedia, car.com, B2B corporate accounts" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",           type: "choice", hint: "Under $10k / $10k–$50k / $50k–$200k / $200k+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",               type: "text",   hint: "e.g. raise fleet utilization to 80%, reduce damage incidents" },
  ],
  healthcare: [
    { slug: "practice_size",        question: "How many doctors/practitioners and locations do you operate?", type: "text", hint: "e.g. 4 doctors, 2 clinics" },
    { slug: "biggest_pain",         question: "What is your single biggest operational challenge?",           type: "text", hint: "e.g. no-shows, appointment scheduling, patient wait time" },
    { slug: "specialties",          question: "What medical specialties does your practice cover?",           type: "text", hint: "e.g. General Practice, Cardiology, Physiotherapy" },
    { slug: "monthly_patients",     question: "Approximately how many patients do you see per month?",        type: "text", hint: "e.g. 300 patients/month" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",                  type: "text", hint: "e.g. reduce no-shows by 30%, open telemedicine, cut wait time" },
  ],
  education: [
    { slug: "institution_size",     question: "How many students are enrolled and how many instructors do you have?", type: "text", hint: "e.g. 200 students, 8 instructors" },
    { slug: "biggest_pain",         question: "What is your single biggest operational challenge?",         type: "text",   hint: "e.g. low enrollment, high dropout, scheduling conflicts" },
    { slug: "course_types",         question: "What types of courses/programs do you offer?",               type: "text",   hint: "e.g. IELTS prep, IT certification, degree programs" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",            type: "choice", hint: "Under PKR 200k / PKR 200k–1M / PKR 1M–5M / PKR 5M+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",                type: "text",   hint: "e.g. increase enrollment by 20%, launch online batch" },
  ],
  logistics: [
    { slug: "fleet_size",           question: "How many vehicles/drivers and warehouses do you operate?",  type: "text",   hint: "e.g. 30 trucks, 5 drivers, 2 warehouses" },
    { slug: "biggest_pain",         question: "What is your single biggest operational headache?",         type: "text",   hint: "e.g. late deliveries, fuel costs, customs delays" },
    { slug: "routes",               question: "Which routes/regions do you primarily serve?",              type: "text",   hint: "e.g. Karachi–Lahore, Pakistan domestic, UAE exports" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",           type: "choice", hint: "Under PKR 500k / PKR 500k–2M / PKR 2M–10M / PKR 10M+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",               type: "text",   hint: "e.g. cut fuel costs 15%, improve on-time delivery to 95%" },
  ],
  events_entertainment: [
    { slug: "event_scale",          question: "How many events do you typically run per month and what is your average venue capacity?", type: "text", hint: "e.g. 4 events/month, avg 500 seats" },
    { slug: "biggest_pain",         question: "What is your single biggest operational challenge?",        type: "text",   hint: "e.g. low ticket sales, artist no-shows, last-minute cancellations" },
    { slug: "ticketing_channels",   question: "Which ticketing channels do you use?",                     type: "text",   hint: "e.g. Eventbrite, Ticketmaster, Direct, Instagram" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",           type: "choice", hint: "Under £5k / £5k–£20k / £20k–£100k / £100k+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",               type: "text",   hint: "e.g. sell out 3 consecutive events, launch VIP tier pricing" },
  ],
  railways: [
    { slug: "network_size",         question: "How many routes, trains, and stations do you operate?",    type: "text",   hint: "e.g. 8 routes, 15 trains, 24 stations" },
    { slug: "biggest_pain",         question: "What is your single biggest operational challenge?",        type: "text",   hint: "e.g. delay management, low occupancy on certain routes, crew scheduling" },
    { slug: "booking_channels",     question: "Which booking channels do passengers use?",                 type: "text",   hint: "e.g. direct app, counter sales, Amadeus, third-party agents" },
    { slug: "monthly_revenue_range",question: "What is your approximate monthly revenue range?",           type: "choice", hint: "Under $50k / $50k–$200k / $200k–$1M / $1M+" },
    { slug: "primary_goal",         question: "What is your #1 goal for the next 90 days?",               type: "text",   hint: "e.g. improve OTR to 90%, increase seat occupancy on Lahore–Karachi route" },
  ],
};

const DEFAULT_QUESTIONS = ONBOARDING_QUESTIONS["hospitality"]!;

// ── GET /api/onboarding/status — is onboarding complete? ─────────────────────
router.get("/status", requireAuth, requireSurface("dashboard"), async (req, res) => {
  const { db, onboardingProfiles } = await import("@workspace/db");
  const userId   = req.user!.sub;
  const industry = (req.query["industry"] as string | undefined) ?? "unknown";

  const [row] = await db
    .select()
    .from(onboardingProfiles)
    .where(and(
      eq(onboardingProfiles.userId, userId),
      eq(onboardingProfiles.industry, industry),
    ))
    .limit(1);

  if (!row) {
    return res.json(ok({ isComplete: false, step: 0, answers: {}, industry }));
  }
  return res.json(ok({
    isComplete:     row.isComplete,
    step:           row.step,
    answers:        row.answers,
    profileSummary: row.profileSummary,
    unlockedKpis:   row.unlockedKpis,
    industry,
  }));
});

// ── GET /api/onboarding/questions/:industry — get questions for industry ──────
router.get("/questions/:industry", requireAuth, requireSurface("dashboard"), async (req, res) => {
  const industry  = req.params["industry"] as string;
  const questions = ONBOARDING_QUESTIONS[industry] ?? DEFAULT_QUESTIONS;
  return res.json(ok({ industry, totalSteps: questions.length, questions }));
});

// ── POST /api/onboarding/answer — submit answer to current step ───────────────
router.post("/answer", requireAuth, requireSurface("dashboard"), async (req, res) => {
  const { db, onboardingProfiles, customer360Profiles } = await import("@workspace/db");
  const userId = req.user!.sub;
  const body   = req.body as { industry: string; step: number; questionSlug: string; answer: string };

  if (!body.industry || body.step === undefined || !body.questionSlug || !body.answer) {
    return res.status(400).json(err("VALIDATION_ERROR", "industry, step, questionSlug, answer required"));
  }

  const questions  = ONBOARDING_QUESTIONS[body.industry] ?? DEFAULT_QUESTIONS;
  const totalSteps = questions.length;
  const nextStep   = body.step + 1;
  const isComplete = nextStep >= totalSteps;

  // Upsert onboarding profile
  const [existing] = await db
    .select()
    .from(onboardingProfiles)
    .where(and(
      eq(onboardingProfiles.userId, userId),
      eq(onboardingProfiles.industry, body.industry),
    ))
    .limit(1);

  const currentAnswers = (existing?.answers as Record<string, string>) ?? {};
  const updatedAnswers = { ...currentAnswers, [body.questionSlug]: body.answer };

  // Build unlocked KPIs based on industry
  const KPI_MAP: Record<string, string[]> = {
    hospitality:          ["occupancy_pct", "adr", "revpar", "booking_rate"],
    airlines:             ["load_factor", "otp", "rasm", "turnaround_time"],
    car_rental:           ["fleet_utilization", "revenue_per_vehicle", "avg_rental_duration"],
    healthcare:           ["room_utilization", "avg_wait_time", "no_show_rate", "patients_per_day"],
    education:            ["room_utilization", "avg_class_size", "attendance_rate", "enrollment_conversion"],
    logistics:            ["otd_pct", "bay_utilization", "avg_transit_time", "cost_per_shipment"],
    events_entertainment: ["venue_utilization", "sell_through_pct", "avg_ticket_price"],
    railways:             ["on_time_rate", "seat_occupancy", "revenue_per_journey"],
  };
  const unlockedKpis = isComplete ? (KPI_MAP[body.industry] ?? []) : [];

  if (existing) {
    await db.update(onboardingProfiles)
      .set({
        step:         nextStep,
        isComplete,
        answers:      updatedAnswers,
        unlockedKpis,
        completedAt:  isComplete ? new Date() : null,
      })
      .where(eq(onboardingProfiles.id, existing.id));
  } else {
    await db.insert(onboardingProfiles).values({
      userId,
      industry:     body.industry,
      step:         nextStep,
      isComplete,
      answers:      updatedAnswers,
      unlockedKpis,
      completedAt:  isComplete ? new Date() : undefined,
    });
  }

  // On completion: update customer_360_profiles with key answers
  if (isComplete) {
    const answers = updatedAnswers as Record<string, string>;
    await db
      .insert(customer360Profiles)
      .values({
        userId,
        industry:            body.industry,
        advisor:             body.industry,
        businessName:        answers["business_name"] ?? null,
        painPoints:          answers["biggest_pain"] ? [answers["biggest_pain"]] : [],
        profileCompleteness: 100,
      })
      .onConflictDoUpdate({
        target: [customer360Profiles.userId],
        set: {
          painPoints:          answers["biggest_pain"] ? [answers["biggest_pain"]] : [],
          profileCompleteness: 100,
          updatedAt:           new Date(),
        },
      });
  }

  const nextQuestion = !isComplete ? questions[nextStep] : null;
  return res.json(ok({
    step:          nextStep,
    isComplete,
    nextQuestion,
    totalSteps,
    unlockedKpis:  isComplete ? unlockedKpis : [],
    message:       isComplete
      ? "Onboarding complete! Your advisor is now fully briefed on your business."
      : `Step ${nextStep + 1} of ${totalSteps}`,
  }));
});

export { router as onboardingRouter };
