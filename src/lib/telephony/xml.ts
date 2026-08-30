/**
 * src/lib/telephony/xml.ts
 *
 * Provider-specific IVR XML rendering (Phase 6f).
 *
 * Every telephony provider has its own XML dialect for controlling a call:
 *   - Exotel  → ExoML  (<Response><Say>...</Say></Response>)
 *   - Plivo   → PHML   (<Response><Speak>...</Speak></Response>)
 *   - Twilio  → TwiML  (<Response><Say voice="alice" language="en-IN">...</Say></Response>)
 *   - FreJun  → FrejunML (<Response><Speak>...</Speak></Response>)
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
 *   gather      — collect a single DTMF digit (IVR menu) and POST it to `action`
 *   recordingUrl — (informational — not rendered in response XML)
 *
 * DTMF menu (Phase 6j):
 *   The `gather` action renders a provider-specific "collect one keypress" block
 *   (<Gather> for Twilio/Exotel, <GetDigits> for Plivo/FreJun) that speaks a
 *   prompt and posts the pressed digit back to `action` (the same webhook URL).
 *   Helper builders `renderLanguageMenu` and `renderDepartmentMenu` compose the
 *   prompt text + option list into a gather action for you.
 *
 * XML safety:
 *   Text content (playText, transferTo) is HTML/XML-escaped before insertion
 *   so that characters like <, >, &, ', " do not break the XML document.
 *
 * Empty action:
 *   If no recognisable action keys are provided an empty <Response/> is returned.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type IvrProvider = "EXOTEL" | "PLIVO" | "TWILIO" | "FREJUN";

export interface IvrAction {
  /** Text to play via TTS */
  playText?: string;
  /** Phone number to transfer/dial to */
  transferTo?: string;
  /** If true, hang up the call */
  hangup?: boolean;
  /** Collect a single DTMF digit (IVR menu). Renders <Gather>/<GetDigits>. */
  gather?: GatherAction;
  /** Recording URL (informational — not rendered in XML) */
  recordingUrl?: string;
}

/**
 * A single DTMF menu option, e.g. { digit: "1", label: "English" }.
 * `value` is a caller-supplied opaque identifier (language code, department id,
 * …) that the webhook interprets; it is NOT rendered into the XML — only the
 * digit + label drive the spoken prompt.
 */
export interface MenuOption {
  /** The DTMF key the caller presses (usually a single digit "0"–"9", "*", "#"). */
  digit: string;
  /** Human-readable label spoken in the prompt (e.g. "English", "Sales"). */
  label: string;
  /** Opaque value the webhook maps the digit back to (not rendered). */
  value?: string;
}

/**
 * A DTMF-collection ("gather") action. Speaks `prompt` then waits for one digit
 * which the provider POSTs to `action` (typically the same webhook URL, which
 * then advances the IVR state machine).
 */
export interface GatherAction {
  /** Prompt spoken before collecting the digit. */
  prompt: string;
  /** Absolute URL the provider POSTs the collected digit to. */
  action: string;
  /** Number of digits to collect. Default 1. */
  numDigits?: number;
  /** Seconds to wait for input before timing out. Default 5. */
  timeout?: number;
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

  // ExoML DTMF: <Gather> wrapping a <Say>. numDigits + action (POST target).
  if (action.gather && action.gather.prompt.trim()) {
    const g = action.gather;
    parts.push(
      `<Gather action="${escapeXml(g.action)}" method="POST" numDigits="${g.numDigits ?? 1}" timeout="${g.timeout ?? 5}">` +
        `<Say voice="female">${escapeXml(g.prompt)}</Say>` +
        `</Gather>`,
    );
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

  // PHML DTMF: <GetDigits> wrapping a <Speak>. numDigits + action (POST target).
  if (action.gather && action.gather.prompt.trim()) {
    const g = action.gather;
    parts.push(
      `<GetDigits action="${escapeXml(g.action)}" method="POST" numDigits="${g.numDigits ?? 1}" timeout="${g.timeout ?? 5}">` +
        `<Speak>${escapeXml(g.prompt)}</Speak>` +
        `</GetDigits>`,
    );
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

  // TwiML DTMF: <Gather> wrapping a <Say>. numDigits + action (POST target).
  if (action.gather && action.gather.prompt.trim()) {
    const g = action.gather;
    parts.push(
      `<Gather action="${escapeXml(g.action)}" method="POST" numDigits="${g.numDigits ?? 1}" timeout="${g.timeout ?? 5}">` +
        `<Say voice="alice" language="en-IN">${escapeXml(g.prompt)}</Say>` +
        `</Gather>`,
    );
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
 * Render FrejunML for FreJun.
 *
 * FreJun uses a similar XML dialect to Plivo (PHML):
 *   <Speak>...</Speak>
 *   <Dial>+91xxxxxxxxxx</Dial>
 *   <Hangup/>
 *
 * // FreJun assumption: FreJun's XML dialect uses <Speak> for TTS (like Plivo),
 * //   plain <Dial> for transfer (like Exotel/Twilio), and <Hangup/> to end calls.
 * //   For DTMF we assume the Plivo-style <GetDigits> element.
 * //   Verify against FreJun's official webhook XML docs if available.
 */
function renderFrejunml(action: IvrAction): string {
  const parts: string[] = [];

  if (action.playText?.trim()) {
    parts.push(`<Speak>${escapeXml(action.playText)}</Speak>`);
  }

  // FrejunML DTMF assumption: <GetDigits> wrapping a <Speak> (Plivo-style).
  if (action.gather && action.gather.prompt.trim()) {
    const g = action.gather;
    parts.push(
      `<GetDigits action="${escapeXml(g.action)}" method="POST" numDigits="${g.numDigits ?? 1}" timeout="${g.timeout ?? 5}">` +
        `<Speak>${escapeXml(g.prompt)}</Speak>` +
        `</GetDigits>`,
    );
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
 * @param provider  "EXOTEL" | "PLIVO" | "TWILIO" | "FREJUN"
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
 *
 *   // FreJun: greeting + transfer
 *   renderIvrResponse("FREJUN", { playText: "Connecting you now.", transferTo: "+911234567890" })
 */
export function renderIvrResponse(provider: IvrProvider, action: IvrAction): string {
  switch (provider) {
    case "EXOTEL":
      return renderExoml(action);
    case "PLIVO":
      return renderPhml(action);
    case "TWILIO":
      return renderTwiml(action);
    case "FREJUN":
      return renderFrejunml(action);
    default: {
      // TypeScript exhaustiveness check — should never reach here
      const exhaustive: never = provider;
      console.warn(`[IVR XML] Unknown provider: ${String(exhaustive)}. Returning empty Response.`);
      return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
    }
  }
}

// ── DTMF menu builders ──────────────────────────────────────────────────────────

/**
 * Compose a spoken menu prompt from an intro line and a list of options.
 *
 * @example
 *   buildMenuPrompt("Select a language.", [
 *     { digit: "1", label: "English" },
 *     { digit: "2", label: "Hindi" },
 *   ])
 *   // → "Select a language. Press 1 for English. Press 2 for Hindi."
 */
export function buildMenuPrompt(intro: string, options: readonly MenuOption[]): string {
  const lines = options
    .filter((o) => o.digit && o.label)
    .map((o) => `Press ${o.digit} for ${o.label}.`);
  const introText = intro.trim();
  return [introText, ...lines].filter(Boolean).join(" ");
}

/**
 * Render a DTMF language-selection menu ("Press 1 for English, 2 for Hindi…").
 *
 * @param provider  Telephony provider.
 * @param options   Language options (digit + label; `value` = BCP-47/ISO code).
 * @param actionUrl Webhook URL the pressed digit is POSTed back to.
 * @param opts      Optional intro override / numDigits / timeout.
 * @returns         Provider-specific XML with a <Gather>/<GetDigits> block.
 *
 * @example
 *   renderLanguageMenu("TWILIO",
 *     [{ digit: "1", label: "English", value: "en-IN" },
 *      { digit: "2", label: "Hindi", value: "hi-IN" }],
 *     "https://app/api/webhooks/voice/tok/dtmf")
 */
export function renderLanguageMenu(
  provider: IvrProvider,
  options: readonly MenuOption[],
  actionUrl: string,
  opts: { intro?: string; numDigits?: number; timeout?: number } = {},
): string {
  const intro = opts.intro ?? "Please select your language.";
  return renderIvrResponse(provider, {
    gather: {
      prompt: buildMenuPrompt(intro, options),
      action: actionUrl,
      numDigits: opts.numDigits ?? 1,
      timeout: opts.timeout,
    },
  });
}

/**
 * Render a DTMF department menu ("Press 1 for Sales, 2 for Support…").
 *
 * @param provider  Telephony provider.
 * @param options   Department options (digit + label; `value` = department id).
 * @param actionUrl Webhook URL the pressed digit is POSTed back to.
 * @param opts      Optional intro override / numDigits / timeout.
 * @returns         Provider-specific XML with a <Gather>/<GetDigits> block.
 */
export function renderDepartmentMenu(
  provider: IvrProvider,
  options: readonly MenuOption[],
  actionUrl: string,
  opts: { intro?: string; numDigits?: number; timeout?: number } = {},
): string {
  const intro = opts.intro ?? "Please choose a department.";
  return renderIvrResponse(provider, {
    gather: {
      prompt: buildMenuPrompt(intro, options),
      action: actionUrl,
      numDigits: opts.numDigits ?? 1,
      timeout: opts.timeout,
    },
  });
}
