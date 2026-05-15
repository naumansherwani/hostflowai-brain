// ─────────────────────────────────────────────────────────────────────────────
// Real AI Language Detection — GPT-5 powered, 15 languages
// NATIVE speaker mode — not translation. AI thinks, feels, responds in that language.
// Matches the HostFlow AI website language selector exactly.
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectedLanguage {
  code:        string;
  name:        string;
  nativeName:  string;
  confidence:  "high" | "medium" | "low";
  rtl:         boolean;
  elevenLabs:  string;   // ElevenLabs language_code for multilingual TTS
}

export const SUPPORTED_LANGUAGES: Record<string, {
  name: string; nativeName: string; rtl: boolean; elevenLabs: string;
}> = {
  en: { name: "English",              nativeName: "English",          rtl: false, elevenLabs: "en"    },
  hi: { name: "Hindi",                nativeName: "हिन्दी",           rtl: false, elevenLabs: "hi"    },
  ur: { name: "Urdu",                 nativeName: "اردو",             rtl: true,  elevenLabs: "ur"    },
  ar: { name: "Arabic",               nativeName: "العربية",          rtl: true,  elevenLabs: "ar"    },
  es: { name: "Spanish",              nativeName: "Español",          rtl: false, elevenLabs: "es"    },
  fr: { name: "French",               nativeName: "Français",         rtl: false, elevenLabs: "fr"    },
  de: { name: "German",               nativeName: "Deutsch",          rtl: false, elevenLabs: "de"    },
  ch: { name: "Swiss German",         nativeName: "Schweizerdeutsch", rtl: false, elevenLabs: "de"    },
  pt: { name: "Portuguese",           nativeName: "Português",        rtl: false, elevenLabs: "pt"    },
  zh: { name: "Chinese (Simplified)", nativeName: "中文",             rtl: false, elevenLabs: "zh"    },
  ja: { name: "Japanese",             nativeName: "日本語",           rtl: false, elevenLabs: "ja"    },
  ko: { name: "Korean",               nativeName: "한국어",           rtl: false, elevenLabs: "ko"    },
  tr: { name: "Turkish",              nativeName: "Türkçe",           rtl: false, elevenLabs: "tr"    },
  it: { name: "Italian",              nativeName: "Italiano",         rtl: false, elevenLabs: "it"    },
  ro: { name: "Romanian",             nativeName: "Română",           rtl: false, elevenLabs: "ro"    },
};

const SUPPORTED_CODES    = Object.keys(SUPPORTED_LANGUAGES).join(", ");
const NATIVE_NAME_LIST   = Object.values(SUPPORTED_LANGUAGES).map(l => l.nativeName).join(", ");

export async function detectLanguage(
  text:   string,
  client: { chat: { completions: { create: Function } } }
): Promise<DetectedLanguage> {
  try {
    const sample = text.slice(0, 500).trim();

    const res = await client.chat.completions.create({
      model:                 "gpt-5",
      max_completion_tokens: 5,
      temperature:           0,
      messages: [
        {
          role:    "system",
          content: `Identify language. Reply ONLY with the ISO code from: ${SUPPORTED_CODES}
Examples: Arabic→ar, Urdu→ur, Chinese→zh, Schweizerdeutsch→ch, Romanian→ro
If not in list or unclear: en`,
        },
        { role: "user", content: sample },
      ],
    });

    const raw  = (res.choices[0]?.message?.content ?? "en").trim().toLowerCase().replace(/[^a-z]/g, "");
    const code = SUPPORTED_LANGUAGES[raw] ? raw : "en";
    const lang = SUPPORTED_LANGUAGES[code]!;

    return {
      code,
      name:        lang.name,
      nativeName:  lang.nativeName,
      confidence:  SUPPORTED_LANGUAGES[raw] ? "high" : "low",
      rtl:         lang.rtl,
      elevenLabs:  lang.elevenLabs,
    };
  } catch {
    return { code: "en", name: "English", nativeName: "English", confidence: "low", rtl: false, elevenLabs: "en" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Native speaker instruction — NOT translation
// The AI IS a native speaker — it doesn't translate, it thinks in that language
// ─────────────────────────────────────────────────────────────────────────────
export function buildLanguageInstruction(lang: DetectedLanguage): string {
  const info = SUPPORTED_LANGUAGES[lang.code];
  if (!info || lang.code === "en") return "";

  return `
LANGUAGE — NATIVE SPEAKER MODE (not translation)
You are a NATIVE ${lang.name} speaker. You think, feel, and communicate in ${info.nativeName} naturally.
This is NOT translation — you write as someone who grew up speaking ${lang.name}.
- Use natural ${lang.name} expressions, idioms, and rhythm — not word-for-word English translation
- ${lang.rtl ? "Script is right-to-left. Use formal ${lang.name} register appropriate for business." : `Use natural ${lang.name} sentence flow.`}
- ${lang.code === "ch" ? "Use Swiss German dialect and expressions — not High German (Hochdeutsch)." : ""}
- ${lang.code === "ar" ? "Use Modern Standard Arabic (فصحى) — professional, clear, not slang." : ""}
- ${lang.code === "ur" ? "Use formal Urdu — respectful 'آپ' form, professional tone." : ""}
- ${["zh", "ja", "ko"].includes(lang.code) ? `Use appropriate ${lang.name} honorifics and business register.` : ""}
- Keep advisor name (Aria, Rex, Atlas etc.) and brand "HostFlow AI" in original form
- Every word in ${info.nativeName} — zero English mixing`;
}
