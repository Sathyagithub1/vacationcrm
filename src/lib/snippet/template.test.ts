/**
 * src/lib/snippet/template.test.ts
 *
 * T49 — Unit tests for the snippet template builder.
 *
 * Node-environment tests (run in CI via vitest.config.ts):
 *   - buildSnippet substitutes tenantToken and baseUrl correctly
 *   - The generated JS contains the expected fetch URL
 *   - The generated JS contains X-Form-Selector header
 *   - The generated JS contains source: "WEBSITE_SNIPPET"
 *
 * Browser-environment tests (run via vitest.ui.config.ts — requires jsdom):
 *   - Delegated submit listener fires
 *   - FormData serialisation
 *   - Selector computation
 *   - X-Captured header handling
 *
 * See TODO_BLOCKERS.md B4 for jsdom installation history.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// ── Browser runtime tests (requires jsdom environment) ───────────────────────
// These tests run under vitest.ui.config.ts which sets environment: "jsdom".
//
// This file is ALSO included by the node config (vitest.config.ts) so the
// token-substitution describe block above runs in CI node tests.  The browser
// describe block below is guard-skipped when `typeof document === "undefined"`
// so that it does not error in the node environment.
//
// To run: npx vitest run --config vitest.ui.config.ts

const isBrowserEnv = typeof document !== "undefined";

describe("buildSnippet() — browser runtime (requires jsdom)", () => {
  const TOKEN = "tok_browser_test";
  const BASE  = "https://crm.example.com";

  // Minimal fetch mock that returns a response with no X-Captured header.
  function makeFetchMock(headers: Record<string, string> = {}) {
    return vi.fn().mockResolvedValue({
      headers: {
        get: (name: string) => headers[name] ?? null,
      },
    });
  }

  beforeEach(() => {
    // Clear sessionStorage before each test so X-Captured state doesn't bleed.
    try { sessionStorage.clear(); } catch { /* no-op in some environments */ }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Remove all event listeners added by executing the snippet IIFE.
    // We do this by replacing the document with a fresh clone — but since
    // jsdom doesn't support that cheaply, we manually track and remove listeners
    // via the cloneNode approach.  Simplest: just replace `document` listeners
    // by using a fresh evaluate per test (we re-eval the IIFE each time).
  });

  /**
   * Execute the snippet IIFE in the jsdom context by eval-ing it.
   * This attaches the delegated submit listener to document.
   */
  function evalSnippet(fetchMock: ReturnType<typeof vi.fn>) {
    // Replace global.fetch so the IIFE's fetch() call uses our mock.
    vi.stubGlobal("fetch", fetchMock);
    // eslint-disable-next-line no-eval
    eval(buildSnippet(TOKEN, BASE));
  }

  it.skipIf(!isBrowserEnv)("attaches a delegated submit listener that calls fetch on form submit", async () => {
    const fetchMock = makeFetchMock();
    evalSnippet(fetchMock);

    // Create and append a form to the document.
    const form = document.createElement("form");
    form.id = "test-form-1";
    const input = document.createElement("input");
    input.name = "name";
    input.value = "Alice";
    form.appendChild(input);
    document.body.appendChild(form);

    // Dispatch a submit event.
    const submitEvent = new Event("submit", { bubbles: true });
    Object.defineProperty(submitEvent, "target", { value: form, writable: false });
    document.dispatchEvent(submitEvent);

    // fetch is called with the correct URL
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/webhooks/intake/${TOKEN}`);

    document.body.removeChild(form);
  });

  it.skipIf(!isBrowserEnv)("serialises form fields and includes source: WEBSITE_SNIPPET in POST body", async () => {
    const fetchMock = makeFetchMock();
    evalSnippet(fetchMock);

    const form = document.createElement("form");
    form.id = "test-form-2";

    const nameInput = document.createElement("input");
    nameInput.name = "name";
    nameInput.value = "Bob";
    form.appendChild(nameInput);

    const phoneInput = document.createElement("input");
    phoneInput.name = "phone";
    phoneInput.value = "+919876543210";
    form.appendChild(phoneInput);

    document.body.appendChild(form);

    const submitEvent = new Event("submit", { bubbles: true });
    Object.defineProperty(submitEvent, "target", { value: form, writable: false });
    document.dispatchEvent(submitEvent);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);

    expect(body.name).toBe("Bob");
    expect(body.phone).toBe("+919876543210");
    expect(body.source).toBe("WEBSITE_SNIPPET");

    document.body.removeChild(form);
  });

  it.skipIf(!isBrowserEnv)("does not call preventDefault when X-Captured header is absent", async () => {
    const fetchMock = makeFetchMock({}); // no X-Captured header
    evalSnippet(fetchMock);

    const form = document.createElement("form");
    form.id = "test-form-3";
    document.body.appendChild(form);

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(submitEvent, "target", { value: form, writable: false });

    // In the jsdom context, because sessionStorage doesn't have the __crm_captured key,
    // preventDefault should NOT be called.
    document.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(false);

    document.body.removeChild(form);
  });

  it.skipIf(!isBrowserEnv)("computes '#id' selector for a form with an id attribute", async () => {
    const fetchMock = makeFetchMock();
    evalSnippet(fetchMock);

    const form = document.createElement("form");
    form.id = "contact-form";
    document.body.appendChild(form);

    const submitEvent = new Event("submit", { bubbles: true });
    Object.defineProperty(submitEvent, "target", { value: form, writable: false });
    document.dispatchEvent(submitEvent);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-Form-Selector"]).toBe("#contact-form");

    document.body.removeChild(form);
  });

  it.skipIf(!isBrowserEnv)("computes nth-of-type selector when form has no id", async () => {
    const fetchMock = makeFetchMock();
    evalSnippet(fetchMock);

    const form = document.createElement("form");
    // No id — selector falls back to nth-of-type path
    document.body.appendChild(form);

    const submitEvent = new Event("submit", { bubbles: true });
    Object.defineProperty(submitEvent, "target", { value: form, writable: false });
    document.dispatchEvent(submitEvent);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;

    // Selector should include nth-of-type since there's no id
    expect(headers["X-Form-Selector"]).toContain("nth-of-type");

    document.body.removeChild(form);
  });
});
