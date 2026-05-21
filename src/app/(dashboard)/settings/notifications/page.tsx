"use client";

import * as React from "react";
import { Bell, Mail, MessageSquare, Smartphone, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";

const NOTIFICATION_TYPES = [
  { key: "LEAD_ASSIGNED", label: "Lead Assigned", description: "When a lead is assigned to you" },
  { key: "FOLLOW_UP_DUE", label: "Follow-up Due", description: "When a follow-up is due" },
  { key: "ESCALATION", label: "Escalation", description: "When an escalation is created or assigned" },
  { key: "CALLBACK", label: "Callback Reminder", description: "When a callback is coming up" },
  { key: "NEW_MESSAGE", label: "New Message", description: "When a new message arrives in a conversation" },
];

const CHANNELS = [
  { key: "IN_APP", label: "In-App", icon: Monitor },
  { key: "EMAIL", label: "Email", icon: Mail },
  { key: "SMS", label: "SMS", icon: Smartphone },
  { key: "WHATSAPP", label: "WhatsApp", icon: MessageSquare },
];

type Settings = Record<string, Record<string, boolean>>;

const DEFAULT_SETTINGS: Settings = {
  LEAD_ASSIGNED: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  FOLLOW_UP_DUE: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  ESCALATION: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  CALLBACK: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  NEW_MESSAGE: { EMAIL: false, SMS: false, WHATSAPP: false, IN_APP: true },
};

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Fetch current tenant notification settings
  React.useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/settings/notifications");
        if (res.ok) {
          const data = await res.json();
          if (data.settings && typeof data.settings === "object" && Object.keys(data.settings).length > 0) {
            setSettings(data.settings);
          }
        }
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  function toggleChannel(type: string, channel: string) {
    setSettings((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [channel]: !prev[type]?.[channel],
      },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      toast("success", "Notification settings saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Settings
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure which channels are used for each notification type
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-700">Notification Type</th>
              {CHANNELS.map((ch) => {
                const Icon = ch.icon;
                return (
                  <th key={ch.key} className="px-4 py-3 text-center font-medium text-gray-700">
                    <div className="flex flex-col items-center gap-1">
                      <Icon className="h-4 w-4" />
                      <span>{ch.label}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((nt) => (
              <tr key={nt.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{nt.label}</div>
                  <div className="text-xs text-gray-500">{nt.description}</div>
                </td>
                {CHANNELS.map((ch) => (
                  <td key={ch.key} className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleChannel(nt.key, ch.key)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 ${
                        settings[nt.key]?.[ch.key] ? "bg-primary-500" : "bg-gray-200"
                      }`}
                      role="switch"
                      aria-checked={settings[nt.key]?.[ch.key] || false}
                      aria-label={`${nt.label} via ${ch.label}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          settings[nt.key]?.[ch.key] ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <strong>Note:</strong> SMS and WhatsApp channels require API configuration.
          Email requires SMTP setup. Contact your administrator if these channels are not available.
        </p>
      </div>
    </div>
  );
}
