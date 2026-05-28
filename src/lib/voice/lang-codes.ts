/**
 * src/lib/voice/lang-codes.ts
 *
 * Shared language-code helpers for STT and TTS (Phase 6f).
 *
 * Google Cloud Speech-to-Text and Text-to-Speech both require BCP-47 tags in
 * the format "<language>-<REGION>" (e.g. "en-IN", "hi-IN").  When callers pass
 * a 2-letter ISO 639-1 code (e.g. "en", "hi") we normalise to the best-fit
 * Indian-English variant via `toGoogleLangCode`.
 *
 * Supported mappings (Indian-market focused):
 *   en → en-IN     (English, India)
 *   hi → hi-IN     (Hindi, India)
 *   ta → ta-IN     (Tamil, India)
 *   te → te-IN     (Telugu, India)
 *   kn → kn-IN     (Kannada, India)
 *   ml → ml-IN     (Malayalam, India)
 *   mr → mr-IN     (Marathi, India)
 *   bn → bn-IN     (Bengali, India)
 *   gu → gu-IN     (Gujarati, India)
 *   pa → pa-IN     (Punjabi, India)
 *   ur → ur-IN     (Urdu, India)
 *
 * Any code that is already in "<xx>-<YY>" format is returned unchanged.
 * Unknown 2-letter codes default to "en-IN".
 */

// ── Language map ──────────────────────────────────────────────────────────────

const ISO2_TO_GOOGLE: Readonly<Record<string, string>> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
  ur: "ur-IN",
} as const;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a 2-letter ISO 639-1 code to a Google BCP-47 language tag.
 *
 * - Already-qualified codes ("en-IN", "hi-IN", "en-US") are returned unchanged.
 * - Known 2-letter codes are mapped to their Indian variant.
 * - Unknown codes default to "en-IN" with a console.warn.
 *
 * @example
 *   toGoogleLangCode("hi")     // "hi-IN"
 *   toGoogleLangCode("en-IN")  // "en-IN"
 *   toGoogleLangCode("ta")     // "ta-IN"
 *   toGoogleLangCode("xx")     // "en-IN" (fallback)
 */
export function toGoogleLangCode(lang: string): string {
  if (!lang) return "en-IN";

  // Already a qualified BCP-47 tag (contains a hyphen) — pass through.
  if (lang.includes("-")) return lang;

  const mapped = ISO2_TO_GOOGLE[lang.toLowerCase()];
  if (mapped) return mapped;

  console.warn(
    `[lang-codes] Unknown ISO 2-letter code "${lang}" — defaulting to "en-IN". ` +
      "Add it to ISO2_TO_GOOGLE in src/lib/voice/lang-codes.ts.",
  );
  return "en-IN";
}
