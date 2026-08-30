/**
 * src/lib/telephony/xml.test.ts
 *
 * Unit tests for the IVR XML renderer (Phase 6f).
 *
 * Tests cover:
 *   - Exotel: playText → <Say voice="female">
 *   - Exotel: transferTo → <Dial>
 *   - Exotel: hangup → <Hangup/>
 *   - Plivo: playText → <Speak>
 *   - Plivo: transferTo → <Dial><Number>
 *   - Plivo: hangup → <Hangup/>
 *   - Twilio: playText → <Say voice="alice" language="en-IN">
 *   - Twilio: transferTo → <Dial>
 *   - Twilio: hangup → <Hangup/>
 *   - XML-unsafe chars in playText are escaped (&, <, >, ", ')
 *   - XML-unsafe chars in transferTo are escaped
 *   - Empty action {} → empty <Response/>
 *   - Combined actions (playText + transferTo) are both rendered
 *   - Response wraps all actions in <Response>
 */

import { describe, it, expect } from "vitest";
import {
  renderIvrResponse,
  renderLanguageMenu,
  renderDepartmentMenu,
  buildMenuPrompt,
  type MenuOption,
} from "./xml";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseXml(xml: string): string {
  // Strip the XML declaration for easier assertions
  return xml.replace(/^<\?xml[^?]*\?>\s*/, "");
}

// ── Exotel (ExoML) ────────────────────────────────────────────────────────────

describe("renderIvrResponse — EXOTEL (ExoML)", () => {
  it("renders <Say voice='female'> for playText", () => {
    const xml = parseXml(renderIvrResponse("EXOTEL", { playText: "Welcome!" }));
    expect(xml).toBe('<Response><Say voice="female">Welcome!</Say></Response>');
  });

  it("renders <Dial> for transferTo", () => {
    const xml = parseXml(renderIvrResponse("EXOTEL", { transferTo: "+911234567890" }));
    expect(xml).toBe("<Response><Dial>+911234567890</Dial></Response>");
  });

  it("renders <Hangup/> for hangup:true", () => {
    const xml = parseXml(renderIvrResponse("EXOTEL", { hangup: true }));
    expect(xml).toBe("<Response><Hangup/></Response>");
  });

  it("renders playText + transferTo in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("EXOTEL", {
        playText: "Transferring now.",
        transferTo: "+911234567890",
      }),
    );
    expect(xml).toContain('<Say voice="female">Transferring now.</Say>');
    expect(xml).toContain("<Dial>+911234567890</Dial>");
  });
});

// ── Plivo (PHML) ──────────────────────────────────────────────────────────────

describe("renderIvrResponse — PLIVO (PHML)", () => {
  it("renders <Speak> for playText", () => {
    const xml = parseXml(renderIvrResponse("PLIVO", { playText: "Hello from Plivo!" }));
    expect(xml).toBe("<Response><Speak>Hello from Plivo!</Speak></Response>");
  });

  it("renders <Dial><Number> for transferTo", () => {
    const xml = parseXml(renderIvrResponse("PLIVO", { transferTo: "+919876543210" }));
    expect(xml).toBe(
      "<Response><Dial><Number>+919876543210</Number></Dial></Response>",
    );
  });

  it("renders <Hangup/> for hangup:true", () => {
    const xml = parseXml(renderIvrResponse("PLIVO", { hangup: true }));
    expect(xml).toBe("<Response><Hangup/></Response>");
  });

  it("renders playText + hangup in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("PLIVO", { playText: "Goodbye!", hangup: true }),
    );
    expect(xml).toContain("<Speak>Goodbye!</Speak>");
    expect(xml).toContain("<Hangup/>");
  });
});

// ── Twilio (TwiML) ────────────────────────────────────────────────────────────

describe("renderIvrResponse — TWILIO (TwiML)", () => {
  it("renders <Say voice='alice' language='en-IN'> for playText", () => {
    const xml = parseXml(renderIvrResponse("TWILIO", { playText: "How can I help?" }));
    expect(xml).toBe(
      '<Response><Say voice="alice" language="en-IN">How can I help?</Say></Response>',
    );
  });

  it("renders <Dial> for transferTo", () => {
    const xml = parseXml(renderIvrResponse("TWILIO", { transferTo: "+911800000000" }));
    expect(xml).toBe("<Response><Dial>+911800000000</Dial></Response>");
  });

  it("renders <Hangup/> for hangup:true", () => {
    const xml = parseXml(renderIvrResponse("TWILIO", { hangup: true }));
    expect(xml).toBe("<Response><Hangup/></Response>");
  });

  it("renders playText + transferTo + hangup in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("TWILIO", {
        playText: "Connecting you now.",
        transferTo: "+911234567890",
        hangup: true,
      }),
    );
    expect(xml).toContain(
      '<Say voice="alice" language="en-IN">Connecting you now.</Say>',
    );
    expect(xml).toContain("<Dial>+911234567890</Dial>");
    expect(xml).toContain("<Hangup/>");
  });
});

// ── XML escaping ──────────────────────────────────────────────────────────────

describe("renderIvrResponse — XML escaping", () => {
  it("escapes & in playText", () => {
    const xml = renderIvrResponse("EXOTEL", {
      playText: "Flights & Hotels",
    });
    expect(xml).toContain("Flights &amp; Hotels");
    expect(xml).not.toContain("Flights & Hotels");
  });

  it("escapes < and > in playText", () => {
    const xml = renderIvrResponse("TWILIO", {
      playText: "Price < 1000 > 500",
    });
    expect(xml).toContain("Price &lt; 1000 &gt; 500");
  });

  it("escapes double quotes in playText", () => {
    const xml = renderIvrResponse("PLIVO", {
      playText: 'Say "hello"',
    });
    expect(xml).toContain("Say &quot;hello&quot;");
  });

  it("escapes single quotes in playText", () => {
    const xml = renderIvrResponse("EXOTEL", {
      playText: "It's confirmed",
    });
    expect(xml).toContain("It&apos;s confirmed");
  });

  it("escapes & in transferTo phone number (edge case)", () => {
    // Unusual but ensure escaping works for all fields
    const xml = renderIvrResponse("EXOTEL", {
      transferTo: "+91&malicious",
    });
    expect(xml).toContain("+91&amp;malicious");
  });
});

// ── FreJun (FrejunML) ─────────────────────────────────────────────────────────

describe("renderIvrResponse — FREJUN (FrejunML)", () => {
  it("renders <Speak> for playText", () => {
    const xml = parseXml(renderIvrResponse("FREJUN", { playText: "Welcome to Holiday Delight!" }));
    expect(xml).toBe("<Response><Speak>Welcome to Holiday Delight!</Speak></Response>");
  });

  it("renders <Dial> for transferTo", () => {
    const xml = parseXml(renderIvrResponse("FREJUN", { transferTo: "+911234567890" }));
    expect(xml).toBe("<Response><Dial>+911234567890</Dial></Response>");
  });

  it("renders <Hangup/> for hangup:true", () => {
    const xml = parseXml(renderIvrResponse("FREJUN", { hangup: true }));
    expect(xml).toBe("<Response><Hangup/></Response>");
  });

  it("renders playText + transferTo in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("FREJUN", {
        playText: "Connecting you to an agent.",
        transferTo: "+919876543210",
      }),
    );
    expect(xml).toContain("<Speak>Connecting you to an agent.</Speak>");
    expect(xml).toContain("<Dial>+919876543210</Dial>");
  });

  it("renders playText + hangup in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("FREJUN", { playText: "Goodbye!", hangup: true }),
    );
    expect(xml).toContain("<Speak>Goodbye!</Speak>");
    expect(xml).toContain("<Hangup/>");
  });

  it("renders playText + transferTo + hangup in sequence", () => {
    const xml = parseXml(
      renderIvrResponse("FREJUN", {
        playText: "Transferring now.",
        transferTo: "+911234567890",
        hangup: true,
      }),
    );
    expect(xml).toContain("<Speak>Transferring now.</Speak>");
    expect(xml).toContain("<Dial>+911234567890</Dial>");
    expect(xml).toContain("<Hangup/>");
  });

  it("returns empty <Response></Response> for empty action", () => {
    const xml = parseXml(renderIvrResponse("FREJUN", {}));
    expect(xml).toBe("<Response></Response>");
  });

  it("escapes & in playText", () => {
    const xml = renderIvrResponse("FREJUN", { playText: "Flights & Hotels" });
    expect(xml).toContain("Flights &amp; Hotels");
    expect(xml).not.toContain("Flights & Hotels");
  });

  it("ignores whitespace-only playText", () => {
    const xml = parseXml(renderIvrResponse("FREJUN", { playText: "   " }));
    expect(xml).toBe("<Response></Response>");
  });
});

// ── Empty / malformed actions ─────────────────────────────────────────────────

describe("renderIvrResponse — empty / partial actions", () => {
  it("returns empty <Response/> for empty action object (Exotel)", () => {
    const xml = parseXml(renderIvrResponse("EXOTEL", {}));
    expect(xml).toBe("<Response></Response>");
  });

  it("returns empty <Response/> for empty action object (Twilio)", () => {
    const xml = parseXml(renderIvrResponse("TWILIO", {}));
    expect(xml).toBe("<Response></Response>");
  });

  it("ignores whitespace-only playText", () => {
    const xml = parseXml(renderIvrResponse("PLIVO", { playText: "   " }));
    expect(xml).toBe("<Response></Response>");
  });

  it("recordingUrl is informational — not rendered in XML", () => {
    const xml = renderIvrResponse("EXOTEL", {
      recordingUrl: "https://cdn.example.com/recording.mp3",
    });
    expect(xml).not.toContain("recording");
    expect(xml).toContain("<Response>");
  });
});

// ── DTMF gather (Phase 6j) ────────────────────────────────────────────────────

const LANG_OPTS: MenuOption[] = [
  { digit: "1", label: "English", value: "en-IN" },
  { digit: "2", label: "Hindi", value: "hi-IN" },
];
const DEPT_OPTS: MenuOption[] = [
  { digit: "1", label: "Sales", value: "dept-sales" },
  { digit: "2", label: "Support", value: "dept-support" },
];
const ACTION_URL = "https://app.example.com/api/webhooks/voice/tok?ivr=lang";

describe("buildMenuPrompt", () => {
  it("composes intro + 'Press N for X' lines", () => {
    expect(buildMenuPrompt("Select a language.", LANG_OPTS)).toBe(
      "Select a language. Press 1 for English. Press 2 for Hindi.",
    );
  });

  it("skips options missing digit or label", () => {
    const prompt = buildMenuPrompt("Menu.", [
      { digit: "1", label: "Sales" },
      { digit: "", label: "Ignored" },
      { digit: "3", label: "" },
    ]);
    expect(prompt).toBe("Menu. Press 1 for Sales.");
  });
});

describe("renderIvrResponse — gather (DTMF) per provider", () => {
  const gather = { prompt: "Press 1 for English. Press 2 for Hindi.", action: ACTION_URL };

  it("Twilio wraps a <Say> in <Gather numDigits action method>", () => {
    const xml = renderIvrResponse("TWILIO", { gather });
    expect(xml).toContain('<Gather action="');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('method="POST"');
    expect(xml).toContain('<Say voice="alice" language="en-IN">Press 1 for English. Press 2 for Hindi.</Say>');
    expect(xml).toContain("</Gather>");
  });

  it("Exotel wraps a <Say voice='female'> in <Gather>", () => {
    const xml = renderIvrResponse("EXOTEL", { gather });
    expect(xml).toContain("<Gather ");
    expect(xml).toContain('<Say voice="female">Press 1 for English. Press 2 for Hindi.</Say>');
    expect(xml).toContain("</Gather>");
  });

  it("Plivo wraps a <Speak> in <GetDigits>", () => {
    const xml = renderIvrResponse("PLIVO", { gather });
    expect(xml).toContain("<GetDigits ");
    expect(xml).toContain("<Speak>Press 1 for English. Press 2 for Hindi.</Speak>");
    expect(xml).toContain("</GetDigits>");
  });

  it("FreJun wraps a <Speak> in <GetDigits> (Plivo-style)", () => {
    const xml = renderIvrResponse("FREJUN", { gather });
    expect(xml).toContain("<GetDigits ");
    expect(xml).toContain("<Speak>Press 1 for English. Press 2 for Hindi.</Speak>");
    expect(xml).toContain("</GetDigits>");
  });

  it("escapes the action URL and prompt (XML safety)", () => {
    const xml = renderIvrResponse("TWILIO", {
      gather: { prompt: "Choose <dept> & press", action: "https://x/y?a=1&b=2" },
    });
    expect(xml).toContain("a=1&amp;b=2");
    expect(xml).toContain("Choose &lt;dept&gt; &amp; press");
  });

  it("honours custom numDigits and timeout", () => {
    const xml = renderIvrResponse("PLIVO", {
      gather: { prompt: "Enter code", action: ACTION_URL, numDigits: 4, timeout: 10 },
    });
    expect(xml).toContain('numDigits="4"');
    expect(xml).toContain('timeout="10"');
  });

  it("skips gather when prompt is blank", () => {
    const xml = parseXml(renderIvrResponse("TWILIO", { gather: { prompt: "  ", action: ACTION_URL } }));
    expect(xml).toBe("<Response></Response>");
  });
});

describe("renderLanguageMenu", () => {
  it("emits a gather with each language option (Twilio)", () => {
    const xml = renderLanguageMenu("TWILIO", LANG_OPTS, ACTION_URL);
    expect(xml).toContain("<Gather ");
    expect(xml).toContain("Please select your language.");
    expect(xml).toContain("Press 1 for English.");
    expect(xml).toContain("Press 2 for Hindi.");
    expect(xml).toContain(`action="${ACTION_URL}"`);
  });

  it("supports a custom intro (Plivo)", () => {
    const xml = renderLanguageMenu("PLIVO", LANG_OPTS, ACTION_URL, { intro: "Pick a language." });
    expect(xml).toContain("<GetDigits ");
    expect(xml).toContain("Pick a language. Press 1 for English. Press 2 for Hindi.");
  });
});

describe("renderDepartmentMenu", () => {
  it("emits a gather with each department option (Exotel)", () => {
    const xml = renderDepartmentMenu("EXOTEL", DEPT_OPTS, ACTION_URL);
    expect(xml).toContain("<Gather ");
    expect(xml).toContain("Please choose a department.");
    expect(xml).toContain("Press 1 for Sales.");
    expect(xml).toContain("Press 2 for Support.");
  });

  it("emits a <GetDigits> menu for FreJun", () => {
    const xml = renderDepartmentMenu("FREJUN", DEPT_OPTS, ACTION_URL);
    expect(xml).toContain("<GetDigits ");
    expect(xml).toContain("Press 1 for Sales.");
    expect(xml).toContain("Press 2 for Support.");
  });
});
