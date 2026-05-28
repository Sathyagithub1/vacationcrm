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
import { renderIvrResponse } from "./xml";

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
