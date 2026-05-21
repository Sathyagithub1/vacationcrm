"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { Mail, MessageSquare, Phone, Eye, EyeOff } from "lucide-react";

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

  // SMS
  const [smsApiKey, setSmsApiKey] = React.useState("");
  const [smsApiUrl, setSmsApiUrl] = React.useState("");
  const [showSmsKey, setShowSmsKey] = React.useState(false);

  // WhatsApp
  const [whatsappApiKey, setWhatsappApiKey] = React.useState("");
  const [whatsappApiUrl, setWhatsappApiUrl] = React.useState("");
  const [showWhatsappKey, setShowWhatsappKey] = React.useState(false);

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
          setSmtpPass(config.smtpPass || "");
          setSmtpFrom(config.smtpFrom || "");
          setSmsApiKey(config.smsApiKey || "");
          setSmsApiUrl(config.smsApiUrl || "");
          setWhatsappApiKey(config.whatsappApiKey || "");
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
      const res = await fetch("/api/tenants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          smtpFrom,
          smsApiKey,
          smsApiUrl,
          whatsappApiKey,
          whatsappApiUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", "Integration settings saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Mask a value for display (show first 4 and last 4 chars).
   */
  function maskValue(value: string): string {
    if (value.length <= 8) return "*".repeat(value.length);
    return value.slice(0, 4) + "*".repeat(value.length - 8) + value.slice(-4);
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
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder="App password or SMTP password"
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
              onChange={(e) => setSmsApiKey(e.target.value)}
              placeholder="Your SMS gateway API key"
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
              onChange={(e) => setWhatsappApiKey(e.target.value)}
              placeholder="Your WhatsApp API key"
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
