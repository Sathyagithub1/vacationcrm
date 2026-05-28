/**
 * src/lib/snippet/template.test.ts
 *
 * T49 — Unit tests for the snippet template builder.
 *
 * Node-environment tests (run in CI):
 *   - buildSnippet substitutes tenantToken and baseUrl correctly
 *   - The generated JS contains the expected fetch URL
 *   - The generated JS contains X-Form-Selector header
 *   - The generated JS contains source: "WEBSITE_SNIPPET"
 *
 * Browser-environment tests (skipped — jsdom not installed):
 *   - Delegated submit listener fires
 *   - FormData serialisation
 *   - Selector computation
 *
 * See TODO_BLOCKERS.md B4 for jsdom installation instructions.
 */

import { describe, it, expect } from "vitest";
import { buildSnippet } from "./template";

// ── Token substitution ────────────────────────────────────────────────────────

describe("buildSnippet() — token substitution", () => {
  const TOKEN   = "tok_abc123";
  const BASE    = "https://crm.example.com";
  let snippet: string;

  // Build once and reuse across tests in this suite.
  // Vitest runs tests in the order they are declared.
  it("returns a non-empty string", () => {
    snippet = buildSnippet(TOKEN, BASE);
    expect(typeof snippet).toBe("string");
    expect(snippet.length).toBeGreaterThan(0);
  });

  it("embeds the tenantToken as a quoted JSON string literal", () => {
    snippet = buildSnippet(TOKEN, BASE);
    // JSON.stringify(TOKEN) == '"tok_abc123"'
    expect(snippet).toContain(JSON.stringify(TOKEN));
  });

  it("embeds the baseUrl as a quoted JSON string literal", () => {
    snippet = buildSnippet(TOKEN, BASE);
    expect(snippet).toContain(JSON.stringify(BASE));
  });

  it("constructs the correct CRM intake URL inside the IIFE", () => {
    snippet = buildSnippet(TOKEN, BASE);
    // The IIFE builds: base + "/api/webhooks/intake/" + token
    expect(snippet).toContain("/api/webhooks/intake/");
  });

  it("includes X-Form-Selector header", () => {
    snippet = buildSnippet(TOKEN, BASE);
    expect(snippet).toContain("X-Form-Selector");
  });

  it("adds source: WEBSITE_SNIPPET to payload", () => {
    snippet = buildSnippet(TOKEN, BASE);
    expect(snippet).toContain("WEBSITE_SNIPPET");
  });

  it("wraps code in an IIFE (starts with '(function')", () => {
    snippet = buildSnippet(TOKEN, BASE);
    // Strip the comment line; the second non-empty line should start with (function
    const lines = snippet.split("\n").filter((l) => l.trim() && !l.trim().startsWith("/*") && !l.trim().startsWith("*"));
    expect(lines[0].trim()).toMatch(/^\(function/);
  });

  it("correctly handles special characters in tenantToken", () => {
    const weirdToken = 'tok_"with"<special>&chars';
    const s = buildSnippet(weirdToken, BASE);
    // JSON.stringify escapes double quotes and other chars safely
    expect(s).toContain(JSON.stringify(weirdToken));
    // The raw unescaped characters should NOT appear
    expect(s).not.toContain(weirdToken);
  });

  it("correctly handles special characters in baseUrl", () => {
    const weirdBase = "https://crm.example.com/path?a=1&b=2";
    const s = buildSnippet(TOKEN, weirdBase);
    expect(s).toContain(JSON.stringify(weirdBase));
  });

  it("two calls with different tokens return different outputs", () => {
    const s1 = buildSnippet("token_one", BASE);
    const s2 = buildSnippet("token_two", BASE);
    expect(s1).not.toBe(s2);
    expect(s1).toContain(JSON.stringify("token_one"));
    expect(s2).toContain(JSON.stringify("token_two"));
  });
});

// ── Browser runtime tests (skipped: jsdom not installed) ─────────────────────
// See TODO_BLOCKERS.md B4 for how to enable these.

describe.skip("buildSnippet() — browser runtime (requires jsdom)", () => {
  it("attaches a delegated submit listener to document", () => {
    // Requires: jsdom environment, DOM APIs
    // To run: install jsdom + configure vitest.ui.config.ts per B1 instructions
  });

  it("serialises form fields and POSTs to the correct URL", () => {
    // Requires: jsdom, fetch mock
  });

  it("does not preventDefault when X-Captured header is absent", () => {
    // Requires: jsdom, fetch mock returning no X-Captured header
  });

  it("computes correct selector for a form with id", () => {
    // Requires: jsdom
  });

  it("computes nth-of-type selector when form has no id", () => {
    // Requires: jsdom
  });
});
