"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import {
  Mail,
  MessageSquare,
  Phone,
  Eye,
  EyeOff,
  CreditCard,
  PhoneCall,
  Mic,
  Volume2,
} from "lucide-react";

// Sentinel returned by the API when a secret is set but masked
const MASKED_SENTINEL = "••••••••";

function isMasked(val: string): boolean {
  return val === MASKED_SENTINEL || /^[•]+$/.test(val);
}

type TelephonyProvider = "" | "EXOTEL" | "FREJUN";
type GoogleProvider = "" | "GOOGLE";

// Derive the public-facing app URL once — used to display copy-pasteable
// webhook URLs to the operator. Falls back to a placeholder if unset so the
// hint still reads coherently.
const APP_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL) ||
  "https://your-app-domain";

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // ── SMTP ────────────────────────────────────────────────────────────────────
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("");
  const [smtpUser, setSmtpUser] = React.useState("");
  const [smtpPass, setSmtpPass] = React.useState("");
  const [smtpFrom, setSmtpFrom] = React.useState("");
  const [showSmtpPass, setShowSmtpPass] = React.useState(false);
  const [smtpPassDirty, setSmtpPassDirty] = React.useState(false);

  // ── SMS ─────────────────────────────────────────────────────────────────────
  const [smsApiKey, setSmsApiKey] = React.useState("");
  const [smsApiUrl, setSmsApiUrl] = React.useState("");
  const [showSmsKey, setShowSmsKey] = React.useState(false);
  const [smsApiKeyDirty, setSmsApiKeyDirty] = React.useState(false);

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  const [whatsappApiKey, setWhatsappApiKey] = React.useState("");
  const [whatsappApiUrl, setWhatsappApiUrl] = React.useState("");
  const [showWhatsappKey, setShowWhatsappKey] = React.useState(false);
  const [whatsappApiKeyDirty, setWhatsappApiKeyDirty] = React.useState(false);

  // ── Razorpay (Phase 6c) ─────────────────────────────────────────────────────
  const [razorpayKeyId, setRazorpayKeyId] = React.useState("");
  const [razorpayKeySecret, setRazorpayKeySecret] = React.useState("");
  const [razorpayWebhookSecret, setRazorpayWebhookSecret] = React.useState("");
  const [showRazorpayKeySecret, setShowRazorpayKeySecret] = React.useState(false);
  const [showRazorpayWebhookSecret, setShowRazorpayWebhookSecret] = React.useState(false);
  const [razorpayKeySecretDirty, setRazorpayKeySecretDirty] = React.useState(false);
  const [razorpayWebhookSecretDirty, setRazorpayWebhookSecretDirty] = React.useState(false);

  // ── Telephony (Phase 6d / 6h) ──────────────────────────────────────────────
  // Provider + phone number are stored plain. Provider-specific credentials
  // are bundled (Exotel: JSON {accountSid, apiKey, apiToken}, FreJun: JSON
  // {apiToken, callerNumber?, webhookSecret}) and stored encrypted as
  // telephonyApiKey. The webhook signature secret is stored separately as
  // telephonyApiSecret — Exotel needs this explicitly; for FreJun the
  // webhookSecret inside the JSON serves the same purpose so we just submit
  // a placeholder for telephonyApiSecret to satisfy the completeness guard.
  const [telephonyProvider, setTelephonyProvider] = React.useState<TelephonyProvider>("");
  const [telephonyPhoneNumber, setTelephonyPhoneNumber] = React.useState("");
  const [telephonyConfigured, setTelephonyConfigured] = React.useState(false);
  // Exotel
  const [exotelAccountSid, setExotelAccountSid] = React.useState("");
  const [exotelApiKey, setExotelApiKey] = React.useState("");
  const [exotelApiToken, setExotelApiToken] = React.useState("");
  const [exotelWebhookSecret, setExotelWebhookSecret] = React.useState("");
  const [showExotelApiKey, setShowExotelApiKey] = React.useState(false);
  const [showExotelApiToken, setShowExotelApiToken] = React.useState(false);
  const [showExotelWebhookSecret, setShowExotelWebhookSecret] = React.useState(false);
  // FreJun
  const [frejunApiToken, setFrejunApiToken] = React.useState("");
  const [frejunCallerNumber, setFrejunCallerNumber] = React.useState("");
  const [frejunWebhookSecret, setFrejunWebhookSecret] = React.useState("");
  const [showFrejunApiToken, setShowFrejunApiToken] = React.useState(false);
  const [showFrejunWebhookSecret, setShowFrejunWebhookSecret] = React.useState(false);
  const [telephonyCredsDirty, setTelephonyCredsDirty] = React.useState(false);

  // ── STT (Phase 6d) ──────────────────────────────────────────────────────────
  const [sttProvider, setSttProvider] = React.useState<GoogleProvider>("");
  const [sttApiKey, setSttApiKey] = React.useState("");
  const [showSttApiKey, setShowSttApiKey] = React.useState(false);
  const [sttApiKeyDirty, setSttApiKeyDirty] = React.useState(false);

  // ── TTS (Phase 6d) ──────────────────────────────────────────────────────────
  const [ttsProvider, setTtsProvider] = React.useState<GoogleProvider>("");
  const [ttsApiKey, setTtsApiKey] = React.useState("");
  const [showTtsApiKey, setShowTtsApiKey] = React.useState(false);
  const [ttsApiKeyDirty, setTtsApiKeyDirty] = React.useState(false);

  // ── Initial load ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    async function fetchTenant() {
      try {
        const res = await fetch("/api/tenants");
        if (!res.ok) throw new Error("fetch failed");
        const { tenant } = await res.json();

        // Existing email/SMS/WhatsApp from emailTemplateConfig JSON
        const config = (tenant.emailTemplateConfig || {}) as Record<string, string>;
        setSmtpHost(config.smtpHost || "");
        setSmtpPort(config.smtpPort || "");
        setSmtpUser(config.smtpUser || "");
        setSmtpPass(config.smtpPass ? MASKED_SENTINEL : "");
        setSmtpPassDirty(false);
        setSmtpFrom(config.smtpFrom || "");
        setSmsApiKey(config.smsApiKey ? MASKED_SENTINEL : "");
        setSmsApiKeyDirty(false);
        setSmsApiUrl(config.smsApiUrl || "");
        setWhatsappApiKey(config.whatsappApiKey ? MASKED_SENTINEL : "");
        setWhatsappApiKeyDirty(false);
        setWhatsappApiUrl(config.whatsappApiUrl || "");

        // Razorpay
        setRazorpayKeyId(tenant.razorpayKeyId || "");
        setRazorpayKeySecret(tenant.razorpayKeySecret ? MASKED_SENTINEL : "");
        setRazorpayKeySecretDirty(false);
        setRazorpayWebhookSecret(tenant.razorpayWebhookSecret ? MASKED_SENTINEL : "");
        setRazorpayWebhookSecretDirty(false);

        // Telephony — provider + phone number are plain; credentials are masked
        setTelephonyProvider((tenant.telephonyProvider || "") as TelephonyProvider);
        setTelephonyPhoneNumber(tenant.telephonyPhoneNumber || "");
        setTelephonyConfigured(Boolean(tenant.telephonyApiKey));
        // Always blank in fields — user re-enters all credentials to change
        setExotelAccountSid("");
        setExotelApiKey("");
        setExotelApiToken("");
        setExotelWebhookSecret("");
        setFrejunApiToken("");
        setFrejunCallerNumber("");
        setFrejunWebhookSecret("");
        setTelephonyCredsDirty(false);

        // STT / TTS
        setSttProvider((tenant.sttProvider || "") as GoogleProvider);
        setSttApiKey(tenant.sttApiKey ? MASKED_SENTINEL : "");
        setSttApiKeyDirty(false);
        setTtsProvider((tenant.ttsProvider || "") as GoogleProvider);
        setTtsApiKey(tenant.ttsApiKey ? MASKED_SENTINEL : "");
        setTtsApiKeyDirty(false);
      } catch {
        toast("error", "Failed to load integration settings");
      } finally {
        setLoading(false);
      }
    }
    fetchTenant();
  }, [toast]);

  // ── Build payload + save ────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
        smsApiUrl,
        whatsappApiUrl,
        // Razorpay non-secret
        razorpayKeyId,
        // Telephony non-secret
        telephonyProvider: telephonyProvider || "",
        telephonyPhoneNumber,
        // STT/TTS provider
        sttProvider: sttProvider || "",
        ttsProvider: ttsProvider || "",
      };

      // Email secrets
      if (smtpPassDirty && smtpPass && !isMasked(smtpPass)) payload.smtpPass = smtpPass;
      if (smsApiKeyDirty && smsApiKey && !isMasked(smsApiKey)) payload.smsApiKey = smsApiKey;
      if (whatsappApiKeyDirty && whatsappApiKey && !isMasked(whatsappApiKey)) payload.whatsappApiKey = whatsappApiKey;

      // Razorpay secrets
      if (razorpayKeySecretDirty && razorpayKeySecret && !isMasked(razorpayKeySecret)) {
        payload.razorpayKeySecret = razorpayKeySecret;
      }
      if (razorpayWebhookSecretDirty && razorpayWebhookSecret && !isMasked(razorpayWebhookSecret)) {
        payload.razorpayWebhookSecret = razorpayWebhookSecret;
      }

      // Telephony credentials — encode by provider
      // telephonyApiKey: provider-specific JSON, encrypted at rest
      // telephonyApiSecret: webhook signature secret, encrypted at rest
      if (telephonyCredsDirty) {
        if (telephonyProvider === "EXOTEL") {
          if (!exotelAccountSid || !exotelApiKey || !exotelApiToken || !exotelWebhookSecret) {
            throw new Error(
              "Exotel requires Account SID, API Key, API Token, AND Webhook Secret — fill all four or leave the section blank to keep existing credentials.",
            );
          }
          payload.telephonyApiKey = JSON.stringify({
            accountSid: exotelAccountSid,
            apiKey: exotelApiKey,
            apiToken: exotelApiToken,
          });
          payload.telephonyApiSecret = exotelWebhookSecret;
        } else if (telephonyProvider === "FREJUN") {
          if (!frejunApiToken || !frejunWebhookSecret) {
            throw new Error(
              "FreJun requires an API Token and Webhook Secret — fill both or leave the section blank to keep existing credentials.",
            );
          }
          payload.telephonyApiKey = JSON.stringify({
            apiToken: frejunApiToken,
            ...(frejunCallerNumber ? { callerNumber: frejunCallerNumber } : {}),
            webhookSecret: frejunWebhookSecret,
          });
          // FreJun's webhook secret lives inside telephonyApiKey JSON; we still
          // populate telephonyApiSecret to satisfy the completeness guard in
          // getTelephonyProvider() — same value, encrypted separately.
          payload.telephonyApiSecret = frejunWebhookSecret;
        }
      }

      // STT/TTS secrets
      if (sttApiKeyDirty && sttApiKey && !isMasked(sttApiKey)) payload.sttApiKey = sttApiKey;
      if (ttsApiKeyDirty && ttsApiKey && !isMasked(ttsApiKey)) payload.ttsApiKey = ttsApiKey;

      const res = await fetch("/api/tenants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }

      // Reset dirty flags + clear typed credential fields after successful save
      setSmtpPassDirty(false);
      setSmsApiKeyDirty(false);
      setWhatsappApiKeyDirty(false);
      setRazorpayKeySecretDirty(false);
      setRazorpayWebhookSecretDirty(false);
      setSttApiKeyDirty(false);
      setTtsApiKeyDirty(false);
      // If telephony creds were saved, remask + clear local fields
      if (telephonyCredsDirty) {
        setTelephonyConfigured(true);
        setExotelAccountSid("");
        setExotelApiKey("");
        setExotelApiToken("");
        setExotelWebhookSecret("");
        setFrejunApiToken("");
        setFrejunCallerNumber("");
        setFrejunWebhookSecret("");
        setTelephonyCredsDirty(false);
      }
      // Refresh secret-field placeholders from new values
      if (razorpayKeySecret && !isMasked(razorpayKeySecret)) setRazorpayKeySecret(MASKED_SENTINEL);
      if (razorpayWebhookSecret && !isMasked(razorpayWebhookSecret)) setRazorpayWebhookSecret(MASKED_SENTINEL);
      if (sttApiKey && !isMasked(sttApiKey)) setSttApiKey(MASKED_SENTINEL);
      if (ttsApiKey && !isMasked(ttsApiKey)) setTtsApiKey(MASKED_SENTINEL);

      toast("success", "Integration settings saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── SMTP ─────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">SMTP Email Configuration</h2>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="SMTP Host"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.gmail.com"
            />
            <Input
              label="SMTP Port"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
            />
          </div>
          <Input
            label="SMTP Username"
            value={smtpUser}
            onChange={(e) => setSmtpUser(e.target.value)}
            placeholder="your@email.com"
          />
          <div className="relative">
            <Input
              label="SMTP Password"
              type={showSmtpPass ? "text" : "password"}
              value={smtpPass}
              onChange={(e) => {
                setSmtpPass(e.target.value);
                setSmtpPassDirty(true);
              }}
              placeholder={smtpPassDirty ? "App password or SMTP password" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowSmtpPass(!showSmtpPass)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showSmtpPass ? "Hide SMTP password" : "Show SMTP password"}
            >
              {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Input
            label="From Email"
            value={smtpFrom}
            onChange={(e) => setSmtpFrom(e.target.value)}
            placeholder="noreply@yourdomain.com"
          />
        </div>
      </div>

      {/* ── SMS Gateway ──────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Phone className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">SMS Gateway</h2>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Input
              label="API Key"
              type={showSmsKey ? "text" : "password"}
              value={smsApiKey}
              onChange={(e) => {
                setSmsApiKey(e.target.value);
                setSmsApiKeyDirty(true);
              }}
              placeholder={smsApiKeyDirty ? "Your SMS gateway API key" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowSmsKey(!showSmsKey)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showSmsKey ? "Hide SMS API key" : "Show SMS API key"}
            >
              {showSmsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Input
            label="API URL"
            value={smsApiUrl}
            onChange={(e) => setSmsApiUrl(e.target.value)}
            placeholder="https://api.smsprovider.com/v1/send"
          />
        </div>
      </div>

      {/* ── WhatsApp ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">WhatsApp API</h2>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Input
              label="API Key"
              type={showWhatsappKey ? "text" : "password"}
              value={whatsappApiKey}
              onChange={(e) => {
                setWhatsappApiKey(e.target.value);
                setWhatsappApiKeyDirty(true);
              }}
              placeholder={whatsappApiKeyDirty ? "Your WhatsApp API key" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowWhatsappKey(!showWhatsappKey)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showWhatsappKey ? "Hide WhatsApp API key" : "Show WhatsApp API key"}
            >
              {showWhatsappKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Input
            label="API URL"
            value={whatsappApiUrl}
            onChange={(e) => setWhatsappApiUrl(e.target.value)}
            placeholder="https://graph.facebook.com/v17.0/..."
          />
        </div>
      </div>

      {/* ── Razorpay (Phase 6c) ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Razorpay Payment Gateway</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Webhook URL to register in Razorpay dashboard:
          <code className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[11px]">
            {APP_URL}/api/webhooks/razorpay/&lt;tenant-token&gt;
          </code>
        </p>

        <div className="space-y-4">
          <Input
            label="Key ID"
            value={razorpayKeyId}
            onChange={(e) => setRazorpayKeyId(e.target.value)}
            placeholder="rzp_live_XXXXXXXXXXXXXXXX"
          />
          <div className="relative">
            <Input
              label="Key Secret"
              type={showRazorpayKeySecret ? "text" : "password"}
              value={razorpayKeySecret}
              onChange={(e) => {
                setRazorpayKeySecret(e.target.value);
                setRazorpayKeySecretDirty(true);
              }}
              placeholder={razorpayKeySecretDirty ? "Razorpay secret key" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowRazorpayKeySecret(!showRazorpayKeySecret)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showRazorpayKeySecret ? "Hide Razorpay key secret" : "Show Razorpay key secret"}
            >
              {showRazorpayKeySecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="relative">
            <Input
              label="Webhook Secret"
              type={showRazorpayWebhookSecret ? "text" : "password"}
              value={razorpayWebhookSecret}
              onChange={(e) => {
                setRazorpayWebhookSecret(e.target.value);
                setRazorpayWebhookSecretDirty(true);
              }}
              placeholder={razorpayWebhookSecretDirty ? "Webhook signing secret" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowRazorpayWebhookSecret(!showRazorpayWebhookSecret)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showRazorpayWebhookSecret ? "Hide Razorpay webhook secret" : "Show Razorpay webhook secret"}
            >
              {showRazorpayWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Telephony (Phase 6d) ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <PhoneCall className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Telephony Provider</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Voice + IVR call routing. Inbound webhook URL:
          <code className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[11px]">
            {APP_URL}/api/webhooks/voice/&lt;tenant-token&gt;
          </code>
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Provider</label>
            <select
              value={telephonyProvider}
              onChange={(e) => setTelephonyProvider(e.target.value as TelephonyProvider)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="">— Disabled —</option>
              <option value="EXOTEL">Exotel</option>
              <option value="FREJUN">FreJun</option>
            </select>
          </div>

          <Input
            label="Business Phone Number"
            value={telephonyPhoneNumber}
            onChange={(e) => setTelephonyPhoneNumber(e.target.value)}
            placeholder="+91XXXXXXXXXX"
          />

          {telephonyProvider === "EXOTEL" && (
            <div className="space-y-3 rounded-md border border-orange-100 bg-orange-50 p-4">
              <p className="text-xs text-gray-600">
                {telephonyConfigured
                  ? "Existing Exotel credentials are stored encrypted. Fill all four fields below to replace them, or leave them blank to keep the existing credentials."
                  : "Enter Account SID, API Key, API Token, and Webhook Secret from your Exotel dashboard. The Webhook Secret is the value you set in Exotel under Settings → Webhook Signing Secret."}
              </p>
              <Input
                label="Account SID"
                value={exotelAccountSid}
                onChange={(e) => {
                  setExotelAccountSid(e.target.value);
                  setTelephonyCredsDirty(true);
                }}
                placeholder="ACXXXXXXXXXXXXXXXX"
              />
              <div className="relative">
                <Input
                  label="API Key"
                  type={showExotelApiKey ? "text" : "password"}
                  value={exotelApiKey}
                  onChange={(e) => {
                    setExotelApiKey(e.target.value);
                    setTelephonyCredsDirty(true);
                  }}
                  placeholder="exo_key_xxxxxxxxxx"
                />
                <button
                  type="button"
                  onClick={() => setShowExotelApiKey(!showExotelApiKey)}
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  aria-label={showExotelApiKey ? "Hide Exotel API key" : "Show Exotel API key"}
                >
                  {showExotelApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative">
                <Input
                  label="API Token"
                  type={showExotelApiToken ? "text" : "password"}
                  value={exotelApiToken}
                  onChange={(e) => {
                    setExotelApiToken(e.target.value);
                    setTelephonyCredsDirty(true);
                  }}
                  placeholder="exo_token_xxxxxxxxxx"
                />
                <button
                  type="button"
                  onClick={() => setShowExotelApiToken(!showExotelApiToken)}
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  aria-label={showExotelApiToken ? "Hide Exotel API token" : "Show Exotel API token"}
                >
                  {showExotelApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative">
                <Input
                  label="Webhook Signing Secret"
                  type={showExotelWebhookSecret ? "text" : "password"}
                  value={exotelWebhookSecret}
                  onChange={(e) => {
                    setExotelWebhookSecret(e.target.value);
                    setTelephonyCredsDirty(true);
                  }}
                  placeholder="The secret used to sign Exotel callbacks"
                />
                <button
                  type="button"
                  onClick={() => setShowExotelWebhookSecret(!showExotelWebhookSecret)}
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  aria-label={showExotelWebhookSecret ? "Hide Exotel webhook secret" : "Show Exotel webhook secret"}
                >
                  {showExotelWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {telephonyProvider === "FREJUN" && (
            <div className="space-y-3 rounded-md border border-orange-100 bg-orange-50 p-4">
              <p className="text-xs text-gray-600">
                {telephonyConfigured
                  ? "Existing FreJun credentials are stored encrypted. Fill API Token + Webhook Secret to replace them, or leave them blank to keep existing."
                  : "Enter your FreJun API Token + Webhook Secret. Caller Number is optional — falls back to the Business Phone Number above."}
              </p>
              <div className="relative">
                <Input
                  label="API Token"
                  type={showFrejunApiToken ? "text" : "password"}
                  value={frejunApiToken}
                  onChange={(e) => {
                    setFrejunApiToken(e.target.value);
                    setTelephonyCredsDirty(true);
                  }}
                  placeholder="frejun_xxxxxxxxxxxxxxxx"
                />
                <button
                  type="button"
                  onClick={() => setShowFrejunApiToken(!showFrejunApiToken)}
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  aria-label={showFrejunApiToken ? "Hide FreJun API token" : "Show FreJun API token"}
                >
                  {showFrejunApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Input
                label="Caller Number (optional)"
                value={frejunCallerNumber}
                onChange={(e) => {
                  setFrejunCallerNumber(e.target.value);
                  setTelephonyCredsDirty(true);
                }}
                placeholder="+91XXXXXXXXXX (defaults to Business Phone Number)"
              />
              <div className="relative">
                <Input
                  label="Webhook Signing Secret"
                  type={showFrejunWebhookSecret ? "text" : "password"}
                  value={frejunWebhookSecret}
                  onChange={(e) => {
                    setFrejunWebhookSecret(e.target.value);
                    setTelephonyCredsDirty(true);
                  }}
                  placeholder="The secret used to sign FreJun callbacks"
                />
                <button
                  type="button"
                  onClick={() => setShowFrejunWebhookSecret(!showFrejunWebhookSecret)}
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  aria-label={showFrejunWebhookSecret ? "Hide FreJun webhook secret" : "Show FreJun webhook secret"}
                >
                  {showFrejunWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── STT (Phase 6d) ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Mic className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Speech-to-Text (STT)</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Transcribes inbound call audio for the IVR voice agent. If left blank, transcription is disabled and the IVR falls back to DTMF-only routing.
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Provider</label>
            <select
              value={sttProvider}
              onChange={(e) => setSttProvider(e.target.value as GoogleProvider)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="">— Disabled —</option>
              <option value="GOOGLE">Google Cloud Speech-to-Text</option>
            </select>
          </div>
          <div className="relative">
            <Input
              label="API Key"
              type={showSttApiKey ? "text" : "password"}
              value={sttApiKey}
              onChange={(e) => {
                setSttApiKey(e.target.value);
                setSttApiKeyDirty(true);
              }}
              placeholder={sttApiKeyDirty ? "Google Cloud API key with STT enabled" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowSttApiKey(!showSttApiKey)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showSttApiKey ? "Hide STT API key" : "Show STT API key"}
            >
              {showSttApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── TTS (Phase 6d) ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Text-to-Speech (TTS)</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Generates outbound IVR voice prompts. If left blank, the IVR falls back to static prompts.
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Provider</label>
            <select
              value={ttsProvider}
              onChange={(e) => setTtsProvider(e.target.value as GoogleProvider)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="">— Disabled —</option>
              <option value="GOOGLE">Google Cloud Text-to-Speech</option>
            </select>
          </div>
          <div className="relative">
            <Input
              label="API Key"
              type={showTtsApiKey ? "text" : "password"}
              value={ttsApiKey}
              onChange={(e) => {
                setTtsApiKey(e.target.value);
                setTtsApiKeyDirty(true);
              }}
              placeholder={ttsApiKeyDirty ? "Google Cloud API key with TTS enabled" : "Set — enter new value to change"}
            />
            <button
              type="button"
              onClick={() => setShowTtsApiKey(!showTtsApiKey)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              aria-label={showTtsApiKey ? "Hide TTS API key" : "Show TTS API key"}
            >
              {showTtsApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex justify-end pb-8">
        <Button onClick={handleSave} loading={saving}>
          Save Integrations
        </Button>
      </div>
    </div>
  );
}
