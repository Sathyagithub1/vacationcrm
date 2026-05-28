"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import {
  MessageCircle,
  Facebook,
  Instagram,
  Mail,
  Smartphone,
  Send,
  Eye,
  EyeOff,
  Copy,
  Check,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ChannelConfig {
  id?: string;
  channel: string;
  isActive: boolean;
  credentials?: Record<string, string>;
  config?: Record<string, unknown>;
  credentialsSet?: boolean;
}

interface FacebookChannelConfig extends ChannelConfig {
  config?: {
    page_id?: string;
    access_token?: string;
    subscribedToLeadgen?: boolean;
    [key: string]: unknown;
  };
}

interface ChannelField {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
}

interface ChannelDef {
  id: string;
  name: string;
  icon: LucideIcon;
  iconColor: string;
  bgColor: string;
  webhookPath: string;
  fields: ChannelField[];
}

const CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: MessageCircle,
    iconColor: "text-green-600",
    bgColor: "bg-green-50",
    webhookPath: "/api/webhooks/whatsapp",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "text", placeholder: "e.g. 123456789012345" },
      { key: "businessAccountId", label: "Business Account ID", type: "text", placeholder: "e.g. 987654321098765" },
      { key: "accessToken", label: "Access Token", type: "password", placeholder: "Permanent access token" },
      { key: "webhookVerifyToken", label: "Webhook Verify Token", type: "text", placeholder: "Your custom verify token" },
    ],
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: Facebook,
    iconColor: "text-blue-600",
    bgColor: "bg-blue-50",
    webhookPath: "/api/webhooks/facebook",
    fields: [
      { key: "pageId", label: "Page ID", type: "text", placeholder: "Facebook Page ID" },
      { key: "pageAccessToken", label: "Page Access Token", type: "password", placeholder: "Page access token" },
      { key: "appSecret", label: "App Secret", type: "password", placeholder: "Facebook App Secret" },
    ],
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: Instagram,
    iconColor: "text-pink-600",
    bgColor: "bg-pink-50",
    webhookPath: "/api/webhooks/instagram",
    fields: [
      { key: "igBusinessAccountId", label: "IG Business Account ID", type: "text", placeholder: "Instagram Business Account ID" },
    ],
  },
  {
    id: "email",
    name: "Email",
    icon: Mail,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-50",
    webhookPath: "/api/webhooks/email",
    fields: [
      { key: "inboundDomain", label: "Inbound Domain", type: "text", placeholder: "e.g. inbound.yourdomain.com" },
      { key: "sendgridApiKey", label: "SendGrid API Key", type: "password", placeholder: "SG.xxxx..." },
    ],
  },
  {
    id: "sms",
    name: "SMS",
    icon: Smartphone,
    iconColor: "text-purple-600",
    bgColor: "bg-purple-50",
    webhookPath: "/api/webhooks/sms",
    fields: [
      { key: "accountSid", label: "Account SID", type: "text", placeholder: "Twilio Account SID" },
      { key: "authToken", label: "Auth Token", type: "password", placeholder: "Twilio Auth Token" },
      { key: "fromNumber", label: "From Number", type: "text", placeholder: "+1234567890" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: Send,
    iconColor: "text-sky-600",
    bgColor: "bg-sky-50",
    webhookPath: "/api/webhooks/telegram",
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" },
    ],
  },
];

export default function ChannelsSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [togglingLeadgen, setTogglingLeadgen] = React.useState(false);
  const [configs, setConfigs] = React.useState<Record<string, ChannelConfig>>({});

  // Modal state
  const [activeChannel, setActiveChannel] = React.useState<ChannelDef | null>(null);
  const [formConfig, setFormConfig] = React.useState<Record<string, string>>({});
  const [formEnabled, setFormEnabled] = React.useState(true);
  const [visiblePasswords, setVisiblePasswords] = React.useState<Record<string, boolean>>({});
  const [copiedWebhook, setCopiedWebhook] = React.useState(false);

  React.useEffect(() => {
    async function fetchConfigs() {
      try {
        const res = await fetch("/api/channel-configs");
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, ChannelConfig> = {};
          (data.configs || []).forEach((c: ChannelConfig) => {
            // API returns uppercase channel names; normalize to lowercase for map key
            map[c.channel.toLowerCase()] = c;
          });
          setConfigs(map);
        }
      } catch {
        toast("error", "Failed to load channel configurations");
      } finally {
        setLoading(false);
      }
    }
    fetchConfigs();
  }, [toast]);

  function getStatus(channelId: string): "active" | "inactive" | "not_configured" {
    const cfg = configs[channelId];
    if (!cfg) return "not_configured";
    return cfg.isActive ? "active" : "inactive";
  }

  function openConfigure(channel: ChannelDef) {
    const existing = configs[channel.id];
    const cfg: Record<string, string> = {};
    channel.fields.forEach((f) => {
      // credentials are never returned from the API; show empty so user re-enters them
      cfg[f.key] = "";
    });
    setFormConfig(cfg);
    setFormEnabled(existing?.isActive ?? true);
    setActiveChannel(channel);
    setVisiblePasswords({});
    setCopiedWebhook(false);
  }

  async function handleSave() {
    if (!activeChannel) return;

    setSaving(true);
    try {
      const existing = configs[activeChannel.id];
      const method = existing?.id ? "PUT" : "POST";
      const url = existing?.id
        ? `/api/channel-configs/${existing.id}`
        : "/api/channel-configs";

      // Build credentials object: only include fields that have been filled in
      const credentials: Record<string, string> = {};
      activeChannel.fields.forEach((f) => {
        if (formConfig[f.key]) credentials[f.key] = formConfig[f.key];
      });

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: activeChannel.id.toUpperCase(),
          isActive: formEnabled,
          credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const saved = await res.json();
      // Normalize key to lowercase to match CHANNELS[].id
      const channelKey = (saved.config.channel as string).toLowerCase();
      setConfigs((prev) => ({ ...prev, [channelKey]: saved.config }));
      setActiveChannel(null);
      toast("success", `${activeChannel.name} configuration saved`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!activeChannel) return;
    const existing = configs[activeChannel.id];
    if (!existing?.id) {
      toast("error", "Save the configuration first before testing");
      return;
    }

    setTesting(true);
    try {
      const res = await fetch(`/api/channel-configs/${existing.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast("success", `${activeChannel.name} connection successful`);
      } else {
        toast("error", data.error || "Connection test failed");
      }
    } catch {
      toast("error", "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleToggle(channelId: string) {
    const existing = configs[channelId];
    if (!existing?.id) return;

    try {
      const res = await fetch(`/api/channel-configs/${existing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: !existing.isActive,
        }),
      });

      if (!res.ok) throw new Error("Failed to update");
      const saved = await res.json();
      // channelId is already lowercase here
      setConfigs((prev) => ({ ...prev, [channelId]: saved.config }));
      toast("success", `${channelId} ${(saved.config as ChannelConfig).isActive ? "enabled" : "disabled"}`);
    } catch {
      toast("error", "Failed to toggle channel");
    }
  }

  async function handleLeadgenToggle(channelId: string) {
    const existing = configs[channelId];
    if (!existing?.id) return;

    const fbCfg = existing as FacebookChannelConfig;
    const isCurrentlySubscribed = fbCfg.config?.subscribedToLeadgen === true;
    const method = isCurrentlySubscribed ? "DELETE" : "POST";

    setTogglingLeadgen(true);
    try {
      const res = await fetch(`/api/channel-configs/${existing.id}/leadgen`, { method });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to update Lead Ads subscription");
      }

      setConfigs((prev) => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          config: data.config as Record<string, unknown>,
        },
      }));
      toast(
        "success",
        isCurrentlySubscribed
          ? "Lead Ads notifications disabled"
          : "Lead Ads notifications enabled",
      );
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to toggle Lead Ads");
    } finally {
      setTogglingLeadgen(false);
    }
  }

  function copyWebhookUrl(path: string) {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Channel cards grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((channel) => {
          const status = getStatus(channel.id);
          const Icon = channel.icon;
          const cfg = configs[channel.id];

          return (
            <div
              key={channel.id}
              className="rounded-lg border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${channel.bgColor}`}>
                    <Icon className={`h-5 w-5 ${channel.iconColor}`} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">{channel.name}</h3>
                </div>
                <Badge
                  variant={
                    status === "active"
                      ? "success"
                      : status === "inactive"
                      ? "warning"
                      : "default"
                  }
                >
                  {status === "active"
                    ? "Active"
                    : status === "inactive"
                    ? "Inactive"
                    : "Not Configured"}
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openConfigure(channel)}
                >
                  Configure
                </Button>
                {cfg?.id && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cfg.isActive}
                    aria-label={`Toggle ${channel.name}`}
                    onClick={() => handleToggle(channel.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      cfg.isActive ? "bg-primary-500" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                        cfg.isActive ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                )}
              </div>

              {/* Lead Ads toggle — Facebook only */}
              {channel.id === "facebook" && cfg?.id && (
                <div className="mt-3 flex items-center justify-between rounded-md bg-blue-50 px-3 py-2">
                  <span className="text-xs font-medium text-blue-800">Lead Ads notifications</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={(cfg as FacebookChannelConfig).config?.subscribedToLeadgen === true}
                    aria-label="Toggle Lead Ads notifications"
                    disabled={togglingLeadgen}
                    onClick={() => handleLeadgenToggle(channel.id)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                      (cfg as FacebookChannelConfig).config?.subscribedToLeadgen === true
                        ? "bg-blue-600"
                        : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
                        (cfg as FacebookChannelConfig).config?.subscribedToLeadgen === true
                          ? "translate-x-4"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Configure Modal */}
      <Modal
        open={!!activeChannel}
        onClose={() => setActiveChannel(null)}
        title={activeChannel ? `Configure ${activeChannel.name}` : ""}
        className="max-w-xl"
      >
        {activeChannel && (
          <div className="space-y-4">
            {/* Fields */}
            {activeChannel.fields.map((field) => (
              <div key={field.key} className="relative">
                <Input
                  label={field.label}
                  type={
                    field.type === "password" && !visiblePasswords[field.key]
                      ? "password"
                      : "text"
                  }
                  value={formConfig[field.key] || ""}
                  onChange={(e) =>
                    setFormConfig((c) => ({ ...c, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                />
                {field.type === "password" && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisiblePasswords((v) => ({
                        ...v,
                        [field.key]: !v[field.key],
                      }))
                    }
                    className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  >
                    {visiblePasswords[field.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            ))}

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Enabled</label>
              <button
                type="button"
                role="switch"
                aria-checked={formEnabled}
                onClick={() => setFormEnabled(!formEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  formEnabled ? "bg-primary-500" : "bg-gray-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                    formEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Webhook URL */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Webhook URL
              </label>
              <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <code className="flex-1 truncate text-xs text-gray-600">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}${activeChannel.webhookPath}`
                    : activeChannel.webhookPath}
                </code>
                <button
                  type="button"
                  onClick={() => copyWebhookUrl(activeChannel.webhookPath)}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  aria-label="Copy webhook URL"
                >
                  {copiedWebhook ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTest}
                loading={testing}
                disabled={!configs[activeChannel.id]?.id}
              >
                <Wifi className="h-4 w-4" />
                Test Connection
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setActiveChannel(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} loading={saving}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
