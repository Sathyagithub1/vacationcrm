/**
 * Holiday Delight CRM — Google Forms Intake Bridge
 * =================================================
 * Paste this entire file into the Apps Script editor attached to your Google
 * Form (Extensions → Apps Script), then configure the two Script Properties
 * below and run `installTrigger` once.
 *
 * SETUP (one-time per form):
 *  1. Open the script editor for your form.
 *  2. Go to Project Settings → Script Properties → Add:
 *       TENANT_TOKEN   — the intakeToken value from your CRM tenant row
 *       SIGNING_KEY    — any strong random string (save it in CRM → Settings →
 *                        Intake → Google Forms Key)
 *       CRM_ENDPOINT   — base URL, e.g. https://yourcrm.example.com/api/webhooks/google-forms
 *  3. Run installTrigger() once to register the onFormSubmit trigger.
 *  4. Authorise the script when prompted (needs UrlFetchApp + FormApp scopes).
 *
 * HOW IT WORKS:
 *  - On every form submission Apps Script calls onFormSubmit().
 *  - The handler flattens the namedValues response to a plain JSON object.
 *  - It computes HMAC-SHA256 of the JSON body using SIGNING_KEY.
 *  - It POSTs to <CRM_ENDPOINT>/<TENANT_TOKEN> with the signature in
 *    X-Signature: sha256=<hex>.
 *  - The CRM verifies the signature and runs the intake pipeline.
 *
 * SECURITY NOTE:
 *  - SIGNING_KEY must match Tenant.googleFormsKey in the CRM database.
 *  - Rotate by generating a new random key, updating both Script Properties
 *    and the CRM setting simultaneously, then re-run installTrigger.
 *  - Never share your Script Properties publicly (they are private to the script).
 */

// ── Configuration ─────────────────────────────────────────────────────────────

var PROPS = PropertiesService.getScriptProperties();

/** Base URL for the CRM intake endpoint (no trailing slash). */
var CRM_ENDPOINT = PROPS.getProperty("CRM_ENDPOINT") || "";

/** Tenant-specific intake token (lives in the URL path). */
var TENANT_TOKEN = PROPS.getProperty("TENANT_TOKEN") || "";

/** HMAC signing key — must match Tenant.googleFormsKey in the CRM. */
var SIGNING_KEY = PROPS.getProperty("SIGNING_KEY") || "";

// ── Trigger installation ───────────────────────────────────────────────────────

/**
 * Run this once manually to install the form-submit trigger.
 * Safe to re-run — it removes any existing onFormSubmit trigger first.
 */
function installTrigger() {
  var form = FormApp.getActiveForm();

  // Remove any existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("onFormSubmit")
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log("onFormSubmit trigger installed for form: " + form.getTitle());
}

// ── Form submit handler ────────────────────────────────────────────────────────

/**
 * Called automatically on every form submission.
 *
 * @param {GoogleAppsScript.Forms.FormEventObject} e - Apps Script form event
 */
function onFormSubmit(e) {
  if (!CRM_ENDPOINT || !TENANT_TOKEN || !SIGNING_KEY) {
    Logger.log("[CRM Bridge] ERROR: Missing script properties. Check CRM_ENDPOINT, TENANT_TOKEN, SIGNING_KEY.");
    return;
  }

  // ── 1. Flatten namedValues to a plain object ────────────────────────────
  // e.response.getItemResponses() returns an ordered array; we key by item
  // title, and join multi-value answers with a comma.
  var namedValues = {};
  var itemResponses = e.response.getItemResponses();

  for (var i = 0; i < itemResponses.length; i++) {
    var item = itemResponses[i];
    var key = item.getItem().getTitle();
    var value = item.getResponse();

    // Multi-select checkboxes return an array — join to a comma string.
    if (Array.isArray(value)) {
      namedValues[key] = value.join(", ");
    } else {
      namedValues[key] = value;
    }
  }

  // ── 2. Add form metadata ─────────────────────────────────────────────────
  namedValues["_formId"]        = e.source ? e.source.getId()    : "";
  namedValues["_responseId"]    = e.response ? e.response.getId() : "";
  namedValues["_submittedAt"]   = new Date().toISOString();
  namedValues["_respondentEmail"] = e.response ? e.response.getRespondentEmail() : "";

  // ── 3. Serialize to JSON ─────────────────────────────────────────────────
  var bodyStr = JSON.stringify(namedValues);

  // ── 4. Compute HMAC-SHA256 signature ─────────────────────────────────────
  // Apps Script's Utilities.computeHmacSha256Signature returns a signed-byte
  // array. We convert it to an unsigned hex string manually.
  var signatureBytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(bodyStr).getBytes(),
    Utilities.newBlob(SIGNING_KEY).getBytes()
  );

  var hexSignature = signatureBytes
    .map(function (b) {
      // Convert signed byte to unsigned hex, zero-padded to 2 chars.
      return ("0" + (b & 0xff).toString(16)).slice(-2);
    })
    .join("");

  var xSignature = "sha256=" + hexSignature;

  // ── 5. POST to CRM ───────────────────────────────────────────────────────
  var url = CRM_ENDPOINT + "/" + TENANT_TOKEN;

  var options = {
    method:             "post",
    contentType:        "application/json",
    payload:            bodyStr,
    headers:            { "X-Signature": xSignature },
    muteHttpExceptions: true,  // don't throw on non-2xx; we'll log instead
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code     = response.getResponseCode();
    var body     = response.getContentText();

    if (code >= 200 && code < 300) {
      Logger.log("[CRM Bridge] Lead submitted successfully. Status: " + code + " Body: " + body);
    } else {
      Logger.log("[CRM Bridge] ERROR: CRM returned " + code + ". Body: " + body);
    }
  } catch (err) {
    Logger.log("[CRM Bridge] EXCEPTION posting to CRM: " + err.toString());
  }
}

// ── Manual test helper ─────────────────────────────────────────────────────────

/**
 * Run this manually from the Apps Script editor to test connectivity without
 * submitting a real form response.
 */
function testConnection() {
  var payload = {
    name:   "Test Connection",
    email:  "test@example.com",
    phone:  "+919999999999",
    _test:  true,
  };

  var bodyStr = JSON.stringify(payload);
  var signatureBytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(bodyStr).getBytes(),
    Utilities.newBlob(SIGNING_KEY).getBytes()
  );

  var hexSig = signatureBytes
    .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); })
    .join("");

  var url = CRM_ENDPOINT + "/" + TENANT_TOKEN;
  var options = {
    method:             "post",
    contentType:        "application/json",
    payload:            bodyStr,
    headers:            { "X-Signature": "sha256=" + hexSig },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log("[CRM Bridge] testConnection → " + response.getResponseCode() + ": " + response.getContentText());
}
