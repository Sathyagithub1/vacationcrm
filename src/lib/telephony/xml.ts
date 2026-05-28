/**
 * src/lib/telephony/xml.ts
 *
 * Provider-specific IVR XML rendering (Phase 6f).
 *
 * Every telephony provider has its own XML dialect for controlling a call:
 *   - Exotel  → ExoML  (<Response><Say>...</Say></Response>)
 *   - Plivo   → PHML   (<Response><Speak>...</Speak></Response>)
 *   - Twilio  → TwiML  (<Response><Say voice="alice" language="en-IN">...</Say></Response>)
 *
 * This module provides a single `renderIvrResponse` function that accepts a
 * provider name and a generic action object, then returns the correct XML string.
 * Webhook handlers use this to return the appropriate `Content-Type: application/xml`
 * response to the telephony provider.
 *
 * Supported actions (all optional; combine freely):
 *   playText    — play TTS text to the caller
 *   transferTo  — transfer/dial to a phone number
 *   hangup      — hang up the call
 *   recordingUrl — (informational — not rendered in response XML)
 *
 * XML safety:
 *   Text content (playText, transferTo) is HTML/XML-escaped before insertion
 *   so that characters like <, >, &, ', " do not break the XML document.
 *
 * Empty action:
 *   If no recognisable action keys are provided an empty <Response/> is returned.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type IvrProvider = "EXOTEL" | "PLIVO" | "TWILIO";

export interface IvrAction {
  /** Text to play via TTS */
  playText?: string;
  /** Phone number to transfer/dial to */
  transferTo?: string;
  /** If true, hang up the call */
  hangup?: boolean;
  /** Recording URL (informational — not rendered in XML) */
  recordingUrl?: string;
}

// ── XML escaping ──────────────────────────────────────────────────────────────

/**
 * Escape XML/HTML special characters to prevent XML injection.
 * Covers &, <, >, ", ' — the 5 predefined XML entities.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Provider renderers ────────────────────────────────────────────────────────

/**
 * Render ExoML for Exotel.
 *
 * ExoML reference: https://developer.exotel.com/api/exoml/
 *   <Say voice="female">...</Say>
 *   <Dial>+91xxxxxxxxxx</Dial>
 *   <Hangup/>
 */
function renderExoml(action: IvrAction): string {
  const parts: string[] = [];

  if (action.playText?.trim()) {
    parts.push(`<Say voice="female">${escapeXml(action.playText)}</Say>`);
  }

  if (action.transferTo?.trim()) {
    parts.push(`<Dial>${escapeXml(action.transferTo)}</Dial>`);
  }

  if (action.hangup) {
    parts.push("<Hangup/>");
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}

/**
 * Render PHML for Plivo.
 *
 * PHML reference: https://www.plivo.com/docs/voice/xml/
 *   <Speak>...</Speak>
 *   <Dial><Number>+91xxxxxxxxxx</Number></Dial>
 *   <Hangup/>
 */
function renderPhml(action: IvrAction): string {
  const parts: string[] = [];

  if (action.playText?.trim()) {
    parts.push(`<Speak>${escapeXml(action.playText)}</Speak>`);
  }

  if (action.transferTo?.trim()) {
    parts.push(`<Dial><Number>${escapeXml(action.transferTo)}</Number></Dial>`);
  }

  if (action.hangup) {
    parts.push("<Hangup/>");
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}

/**
 * Render TwiML for Twilio.
 *
 * TwiML reference: https://www.twilio.com/docs/voice/twiml
 *   <Say voice="alice" language="en-IN">...</Say>
 *   <Dial>+91xxxxxxxxxx</Dial>
 *   <Hangup/>
 */
function renderTwiml(action: IvrAction): string {
  const parts: string[] = [];

  if (action.playText?.trim()) {
    parts.push(`<Say voice="alice" language="en-IN">${escapeXml(action.playText)}</Say>`);
  }

  if (action.transferTo?.trim()) {
    parts.push(`<Dial>${escapeXml(action.transferTo)}</Dial>`);
  }

  if (action.hangup) {
    parts.push("<Hangup/>");
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a provider-specific IVR XML response string.
 *
 * @param provider  "EXOTEL" | "PLIVO" | "TWILIO"
 * @param action    Action object (all fields optional).
 *                  Pass an empty object `{}` to get an empty <Response/>.
 * @returns         XML string ready to return as `Content-Type: application/xml`.
 *
 * @example
 *   // Exotel: play greeting
 *   renderIvrResponse("EXOTEL", { playText: "Welcome to Holiday Delight!" })
 *   // → '<?xml version="1.0" ...?><Response><Say voice="female">Welcome...</Say></Response>'
 *
 *   // Plivo: transfer
 *   renderIvrResponse("PLIVO", { playText: "Transferring you now.", transferTo: "+911234567890" })
 *
 *   // Twilio: hangup
 *   renderIvrResponse("TWILIO", { playText: "Goodbye!", hangup: true })
 */
export function renderIvrResponse(provider: IvrProvider, action: IvrAction): string {
  switch (provider) {
    case "EXOTEL":
      return renderExoml(action);
    case "PLIVO":
      return renderPhml(action);
    case "TWILIO":
      return renderTwiml(action);
    default: {
      // TypeScript exhaustiveness check — should never reach here
      const exhaustive: never = provider;
      console.warn(`[IVR XML] Unknown provider: ${String(exhaustive)}. Returning empty Response.`);
      return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
    }
  }
}
