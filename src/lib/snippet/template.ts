/**
 * src/lib/snippet/template.ts
 *
 * T49 — Website snippet template builder.
 *
 * Exports `buildSnippet(tenantToken, baseUrl)` which returns a self-contained
 * IIFE (plain ES2015 JS — NOT TypeScript) suitable for serving as
 * `text/javascript` from /snippet/[tenantToken].
 *
 * The returned string is injected into the tenant's page via a single
 * `<script>` tag:
 *   <script src="https://crm.example.com/snippet/YOUR_TOKEN"></script>
 *
 * Runtime behaviour (runs in the tenant's browser):
 *  - Attaches ONE delegated `submit` listener on `document` (not per-form).
 *  - On submit, serialises all form fields to a JSON object using FormData.
 *  - Computes a CSS selector path for the submitted form.
 *  - POSTs the payload to `<baseUrl>/api/webhooks/intake/<tenantToken>`.
 *  - Does NOT preventDefault by default — so the form's native action still
 *    fires. Only calls preventDefault if the CRM response includes the header
 *    `X-Captured: 1`.
 */

/**
 * Builds the injected JavaScript snippet for a given tenant.
 *
 * @param tenantToken - The tenant's `intakeToken` value (substituted into the
 *   generated JS at build time so the script is self-contained).
 * @param baseUrl - The CRM origin (e.g. `https://crm.example.com`). Injected
 *   as a literal string into the IIFE.
 * @returns A string containing the IIFE ready to serve as `text/javascript`.
 */
export function buildSnippet(tenantToken: string, baseUrl: string): string {
  // Escape both values so they can be safely embedded in a JS string literal.
  const safeToken = JSON.stringify(tenantToken);
  const safeBase  = JSON.stringify(baseUrl);

  return `/* Holiday Delight CRM — website snippet (auto-generated, do not edit) */
(function (token, base) {
  "use strict";

  /**
   * Compute a CSS selector that uniquely identifies the given form element.
   * Uses the form's id attribute when present; otherwise falls back to an
   * nth-of-type chain from the document root.
   *
   * @param {HTMLElement} el
   * @returns {string}
   */
  function selectorFor(el) {
    if (el.id) return "#" + el.id;

    var parts = [];
    var node  = el;

    while (node && node !== document.documentElement) {
      var tag    = node.tagName.toLowerCase();
      var parent = node.parentElement;

      if (!parent) {
        parts.unshift(tag);
        break;
      }

      var siblings = Array.prototype.filter.call(
        parent.children,
        function (c) { return c.tagName === node.tagName; }
      );

      var idx = siblings.indexOf(node) + 1;
      parts.unshift(tag + ":nth-of-type(" + idx + ")");
      node = parent;
    }

    return parts.join(" > ");
  }

  /**
   * Convert a FormData instance to a plain JSON-serialisable object.
   * Multi-value fields (e.g. checkboxes) are joined with ", ".
   *
   * @param {FormData} fd
   * @returns {Object}
   */
  function formDataToObject(fd) {
    var obj = {};
    fd.forEach(function (value, key) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = obj[key] + ", " + value;
      } else {
        obj[key] = String(value);
      }
    });
    return obj;
  }

  // Attach a single delegated listener on document.
  // capture=false so the listener fires in the bubbling phase after the form's
  // own onsubmit handlers have run.
  document.addEventListener("submit", function (event) {
    var form = event.target;

    if (!form || form.tagName !== "FORM") return;

    var selector = selectorFor(form);
    var fields   = formDataToObject(new FormData(form));
    var payload  = Object.assign({}, fields, { source: "WEBSITE_SNIPPET" });
    var url      = base + "/api/webhooks/intake/" + token;

    // Fire the CRM POST.  We use keepalive so the request survives page
    // navigation triggered by the form's native action.
    fetch(url, {
      method:    "POST",
      keepalive: true,
      headers: {
        "Content-Type":    "application/json",
        "X-Form-Selector": selector
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      // If the server sets X-Captured: 1, prevent the form's default action on
      // FUTURE submits by storing the flag.  We cannot retroactively cancel the
      // current submission here because it may have already navigated.
      if (res.headers && res.headers.get("X-Captured") === "1") {
        try { sessionStorage.setItem("__crm_captured_" + token, "1"); } catch (e) {}
      }
    })["catch"](function () {});

    // For the CURRENT submit: check if the server previously returned
    // X-Captured: 1 (stored from the last response) and prevent default if so.
    try {
      if (sessionStorage.getItem("__crm_captured_" + token) === "1") {
        event.preventDefault();
      }
    } catch (e) {}
  }, false);

}(${safeToken}, ${safeBase}));
`;
}
