import { Router, type IRouter } from "express";
import { ok, err } from "../lib/response.js";
import { getAdvisor, OWNER_ADVISOR } from "../lib/advisor-voice-config.js";
import { SUPPORTED_LANGUAGES } from "../lib/language-detection.js";

const router: IRouter = Router();

const ELEVENLABS_KEY = process.env["ELEVENLABS_API_KEY"] ?? "";

// Welcome messages per industry — cinematic, world-class, luxury-grade opening
const WELCOME_MESSAGES: Record<string, string> = {
  hospitality:
    "Good day. I am Aria — your Executive Revenue and Operations Director for Travel, Tourism, and Hospitality. " +
    "From this moment, every room, every booking channel, every guest experience, and every revenue opportunity is under active intelligence. " +
    "Booking dot com, Airbnb, Agoda, direct bookings, WhatsApp reservations — I monitor and optimise all of it, simultaneously, around the clock. " +
    "Your business is now operating at a level most luxury hotel groups spend millions to reach. Welcome to HostFlow AI.",

  tourism_hospitality:
    "Good day. I am Aria — your Executive Revenue and Operations Director for Travel, Tourism, and Hospitality. " +
    "From this moment, every room, every booking channel, every guest experience, and every revenue opportunity is under active intelligence. " +
    "Booking dot com, Airbnb, Agoda, direct bookings, WhatsApp reservations — I monitor and optimise all of it, simultaneously, around the clock. " +
    "Your business is now operating at a level most luxury hotel groups spend millions to reach. Welcome to HostFlow AI.",

  airlines:
    "Good day. I am Captain Orion — your Chief Aviation Intelligence and Fleet Revenue Commander. " +
    "Every flight, every seat, every fare class, and every revenue opportunity across your network is now under active command. " +
    "From yield management and overbooking strategy to crew scheduling, slot recovery, and EU Two-Sixty-One compliance — I handle it all. " +
    "You now have the operational intelligence of a Tier One global carrier, available to you around the clock. " +
    "Cleared for departure. Welcome to HostFlow AI.",

  car_rental:
    "Good day. I am Rex — your Fleet Revenue and Operations Director. " +
    "Every vehicle in your fleet, every booking, every utilisation rate, and every pricing opportunity is now under active management. " +
    "Dynamic fleet pricing, damage risk assessment, peak demand forecasting — all running in real time. " +
    "Your fleet is no longer just a rental operation. It is a precision revenue machine. Welcome to HostFlow AI.",

  healthcare:
    "Good day. I am Doctor Lyra — your Clinical Operations and Patient Experience Director. " +
    "Every appointment, every care pathway, every resource, and every patient interaction is now under intelligent management. " +
    "From appointment optimisation and no-show reduction to HIPAA-compliant data handling and doctor schedule coordination — I am fully active. " +
    "Your practice now operates with the precision of a world-class medical institution. Welcome to HostFlow AI.",

  education:
    "Good day. I am Professor Sage — your Academic Operations and Enrollment Intelligence Director. " +
    "Every student journey, every enrollment pipeline, every class schedule, and every institutional KPI is now under active oversight. " +
    "Attendance intelligence, dropout risk detection, curriculum optimisation, and administrative automation — all live. " +
    "Your institution is now powered by the same intelligence as the world's leading academic organisations. Welcome to HostFlow AI.",

  logistics:
    "Good day. I am Atlas — your Supply Chain and Logistics Intelligence Director. " +
    "Every route, every shipment, every delivery window, and every cost optimisation opportunity is now under active command. " +
    "Real-time route intelligence, delay prediction, customs coordination, and fleet efficiency — running continuously. " +
    "Your logistics operation now has the precision and intelligence of a global tier-one supply chain. Welcome to HostFlow AI.",

  events_entertainment:
    "Good day. I am Vega — your Event Revenue and Experience Director. " +
    "Every event, every ticket, every vendor, and every attendee experience is now under active management. " +
    "Dynamic pricing, capacity optimisation, vendor coordination, and real-time sentiment monitoring — all live. " +
    "Your events now carry the production intelligence of the world's most prestigious entertainment organisations. Welcome to HostFlow AI.",

  railways:
    "Good day. I am Conductor Kai — your Rail Network and Passenger Operations Director. " +
    "Every train, every route, every seat, and every schedule is now under precision management. " +
    "PNR management, berth allocation, Tatkal pricing, delay prediction, and passenger communication — all active. " +
    "Your railway operations now run with the precision of the world's most advanced transit systems. Welcome to HostFlow AI.",

  general:
    "Good day. Welcome to HostFlow AI — the AI Operating System built for the world's most demanding industries. " +
    "You are now connected to a network of world-class AI advisors: Aria for Hospitality, Captain Orion for Airlines, Rex for Car Rental, " +
    "Doctor Lyra for Healthcare, Professor Sage for Education, Atlas for Logistics, Vega for Events, and Conductor Kai for Railways. " +
    "Every advisor operates at executive level — protecting revenue, optimising operations, and growing your business around the clock. " +
    "I am Sherlock, Head of All Advisors. Whatever your industry requires — we are ready. Welcome.",
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice/welcome  — Industry welcome audio (advisor voice)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/voice/welcome", async (req, res) => {
  const { industry, lang } = req.query as { industry?: string; lang?: string };

  const message   = WELCOME_MESSAGES[industry ?? "general"] ?? WELCOME_MESSAGES["general"]!;
  const advisor   = industry ? getAdvisor(industry) : null;
  const voiceId   = advisor?.voiceId   ?? OWNER_ADVISOR.voiceId;
  const voiceName = advisor?.voiceName ?? OWNER_ADVISOR.voiceName;
  const langInfo  = SUPPORTED_LANGUAGES[lang ?? "en"];
  const elLangCode = langInfo?.elevenLabs ?? "en";

  req.log.info({ industry, advisor: advisor?.name ?? "default", voice: voiceId, lang }, "Voice welcome request");

  if (ELEVENLABS_KEY) {
    try {
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key":   ELEVENLABS_KEY,
            "Content-Type": "application/json",
            Accept:         "audio/mpeg",
          },
          body: JSON.stringify({
            text:     message,
            model_id: "eleven_turbo_v2_5",   // multilingual model
            voice_settings: {
              stability:        0.55,
              similarity_boost: 0.85,
              style:            0.2,
              use_speaker_boost: true,
            },
            language_code: elLangCode,         // native language output
          }),
        }
      );

      if (ttsRes.ok) {
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        res.json(ok({
          audio_base64: audioBuffer.toString("base64"),
          audio_format: "audio/mpeg",
          message_text: message,
          advisor:      advisor?.name      ?? "HostFlow AI",
          voice:        voiceName,
          voice_id:     voiceId,
          industry:     industry ?? "general",
          language:     elLangCode,
          provider:     "elevenlabs",
          model:        "eleven_turbo_v2_5",
        }, req.trace_id));
        return;
      }

      req.log.warn({ status: ttsRes.status }, "ElevenLabs TTS non-OK response");
    } catch (e) {
      req.log.warn({ err: e }, "ElevenLabs TTS failed, returning text fallback");
    }
  }

  res.json(ok({
    audio_base64: null,
    audio_format: null,
    message_text: message,
    advisor:      advisor?.name ?? "HostFlow AI",
    voice:        voiceName,
    voice_id:     voiceId,
    industry:     industry ?? "general",
    language:     elLangCode,
    provider:     "text_only",
    model:        "eleven_turbo_v2_5",
  }, req.trace_id));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice/speak  — Text-to-speech for any advisor in any language
// Used by: in-app chat (advisor voice replies), WhatsApp voice notes
// ─────────────────────────────────────────────────────────────────────────────
router.post("/voice/speak", async (req, res) => {
  const { text, industry, lang } = req.body as {
    text:      string;
    industry?: string;
    lang?:     string;
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json(err("VALIDATION_ERROR", "text is required", req.trace_id));
    return;
  }

  if (!ELEVENLABS_KEY) {
    res.status(503).json(err("SERVICE_UNAVAILABLE", "ElevenLabs not configured", req.trace_id));
    return;
  }

  const advisor    = industry ? getAdvisor(industry) : null;
  const voiceId    = advisor?.voiceId   ?? OWNER_ADVISOR.voiceId;
  const voiceName  = advisor?.voiceName ?? OWNER_ADVISOR.voiceName;
  const langInfo   = SUPPORTED_LANGUAGES[lang ?? "en"];
  const elLangCode = langInfo?.elevenLabs ?? "en";

  req.log.info({ industry, advisor: advisor?.name, lang, textLen: text.length }, "Voice speak request");

  try {
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key":   ELEVENLABS_KEY,
          "Content-Type": "application/json",
          Accept:         "audio/mpeg",
        },
        body: JSON.stringify({
          text:     text.slice(0, 2500),
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability:        0.55,
            similarity_boost: 0.85,
            style:            0.2,
            use_speaker_boost: true,
          },
          language_code: elLangCode,
        }),
      }
    );

    if (!ttsRes.ok) {
      const errBody = await ttsRes.text();
      req.log.error({ status: ttsRes.status, body: errBody }, "ElevenLabs error");
      res.status(502).json(err("TTS_ERROR", "ElevenLabs TTS failed", req.trace_id));
      return;
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    res.json(ok({
      audio_base64:  audioBuffer.toString("base64"),
      audio_format:  "audio/mpeg",
      advisor:       advisor?.name ?? "HostFlow AI",
      voice:         voiceName,
      voice_id:      voiceId,
      language:      elLangCode,
      characters:    text.length,
      model:         "eleven_turbo_v2_5",
      provider:      "elevenlabs",
    }, req.trace_id));
  } catch (e) {
    req.log.error({ err: e }, "Voice speak failed");
    res.status(500).json(err("TTS_ERROR", "Voice generation failed", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice/config  — Voice config for all advisors (for Lovable)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/voice/config", (_req, res) => {
  const advisors = ["tourism_hospitality","airlines","car_rental","healthcare","education","logistics","events_entertainment","railways"]
    .map(ind => {
      const a = getAdvisor(ind)!;
      return { industry: ind, advisor: a.name, voice_id: a.voiceId, voice_name: a.voiceName };
    });

  res.json(ok({
    model:         "eleven_turbo_v2_5",
    multilingual:  true,
    languages:     15,
    language_codes: Object.entries(SUPPORTED_LANGUAGES).map(([code, l]) => ({
      code, name: l.name, native: l.nativeName, elevenlabs_code: l.elevenLabs, rtl: l.rtl,
    })),
    advisors,
    owner_advisor: { advisor: OWNER_ADVISOR.name, voice_id: OWNER_ADVISOR.voiceId, voice_name: OWNER_ADVISOR.voiceName },
    endpoints: {
      welcome: "GET /api/voice/welcome?industry=airlines&lang=ar",
      speak:   "POST /api/voice/speak",
      config:  "GET /api/voice/config",
    },
  }, "voice-config"));
});

export default router;
