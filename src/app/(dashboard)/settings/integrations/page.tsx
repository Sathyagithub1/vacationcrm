"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { Mail, MessageSquare, Phone, Eye, EyeOff } from "lucide-react";

// Sentinel value returned by the API for masked secrets
const MASKED_SENTINEL = "••••••••";

function isMasked(val: string): boolean {
  return val === MASKED_SENTINEL || /^[•]+$/.test(val);
}

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // SMTP
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("");
  const [smtpUser, setSmtpUser] = React.useState("");
  const [smtpPass, setSmtpPass] = React.useState("");
  const [smtpFrom, setSmtpFrom] = React.useState("");
  const [showSmtpPass, setShowSmtpPass] = React.useState(false);
  // Track which secret fields have been dirtied by the user
  const [smtpPassDirty, setSmtpPassDirty] = React.useState(false);

  // SMS
  const [smsApiKey, setSmsApiKey] = React.useState("");
  const [smsApiUrl, setSmsApiUrl] = React.useState("");
  const [showSmsKey, setShowSmsKey] = React.useState(false);
  const [smsApiKeyDirty, setSmsApiKeyDirty] = React.useState(false);

  // WhatsApp
  const [whatsappApiKey, setWhatsappApiKey] = React.useState("");
  const [whatsappApiUrl, setWhatsappApiUrl] = React.useState("");
  const [showWhatsappKey, setShowWhatsappKey] = React.useState(false);
  const [whatsappApiKeyDirty, setWhatsappApiKeyDirty] = React.useState(false);

  // Fetch existing config
  React.useEffect(() => {
    async function fetchTenant() {
      try {
        const res = await fetch("/api/tenants");
        if (res.ok) {
          const { tenant } = await res.json();
          const config = (tenant.emailTemplateConfig || {}) as Record<string, string>;
          setSmtpHost(config.smtpHost || "");
          setSmtpPort(config.smtpPort || "");
          setSmtpUser(config.smtpUser || "");
          // Masked password — display as bullets placeholder, not in field value
          setSmtpPass(config.smtpPass ? MASKED_SENTINEL : "");
          setSmtpPassDirty(false);
          setSmtpFrom(config.smtpFrom || "");
          setSmsApiKey(config.smsApiKey ? MASKED_SENTINEL : "");
          setSmsApiKeyDirty(false);
          setSmsApiUrl(config.smsApiUrl || "");
          setWhatsappApiKey(config.whatsappApiKey ? MASKED_SENTINEL : "");
          setWhatsappApiKeyDirty(false);
          setWhatsappApiUrl(config.whatsappApiUrl || "");
        }
      } catch {
        toast("error", "Failed to load integration settings");
      } finally {
        setLoading(false);
      }
    }
    fetchTenant();
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      // Build payload: only include secret fields if they were dirtied with a real new value
      const payload: Record<string, string> = {
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
        smsApiUrl,
        whatsappApiUrl,
      };

      // Only send secret if user actually typed a new value (not the masked placeholder)
      if (smtpPassDirty && smtpPass && !isMasked(smtpPass)) {
        payload.smtpPass = smtpPass;
      }
      if (smsApiKeyDirty && smsApiKey && !isMasked(smsApiKey)) {
        payload.smsApiKey = smsApiKey;
      }
      if (whatsappApiKeyDirty && whatsappApiKey && !isMasked(whatsappApiKey)) {
        payload.whatsappApiKey = whatsappApiKey;
      }

      const res = await fetch("/api/tenants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      // Reset dirty flags after successful save
      setSmtpPassDirty(false);
      setSmsApiKeyDirty(false);
      setWhatsappApiKeyDirty(false);

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
      {/* SMTP Configuration */}
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

      {/* SMS Gateway */}
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

      {/* WhatsApp */}
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

      {/* Save */}
      <div className="flex justify-end pb-8">
        <Button onClick={handleSave} loading={saving}>
          Save Integrations
        </Button>
      </div>
    </div>
  );
}
