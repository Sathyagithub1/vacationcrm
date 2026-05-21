"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";

const TIMEZONES = [
  { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
  { label: "Asia/Dubai (GST)", value: "Asia/Dubai" },
  { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
  { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Asia/Shanghai (CST)", value: "Asia/Shanghai" },
  { label: "Europe/London (GMT/BST)", value: "Europe/London" },
  { label: "Europe/Paris (CET)", value: "Europe/Paris" },
  { label: "Europe/Berlin (CET)", value: "Europe/Berlin" },
  { label: "America/New_York (EST)", value: "America/New_York" },
  { label: "America/Chicago (CST)", value: "America/Chicago" },
  { label: "America/Denver (MST)", value: "America/Denver" },
  { label: "America/Los_Angeles (PST)", value: "America/Los_Angeles" },
  { label: "Australia/Sydney (AEST)", value: "Australia/Sydney" },
  { label: "Pacific/Auckland (NZST)", value: "Pacific/Auckland" },
  { label: "Africa/Nairobi (EAT)", value: "Africa/Nairobi" },
  { label: "UTC", value: "UTC" },
];

const CURRENCIES = [
  { label: "INR - Indian Rupee", value: "INR" },
  { label: "USD - US Dollar", value: "USD" },
  { label: "EUR - Euro", value: "EUR" },
  { label: "GBP - British Pound", value: "GBP" },
  { label: "AED - UAE Dirham", value: "AED" },
  { label: "SGD - Singapore Dollar", value: "SGD" },
  { label: "AUD - Australian Dollar", value: "AUD" },
  { label: "CAD - Canadian Dollar", value: "CAD" },
  { label: "JPY - Japanese Yen", value: "JPY" },
  { label: "CNY - Chinese Yuan", value: "CNY" },
  { label: "THB - Thai Baht", value: "THB" },
  { label: "MYR - Malaysian Ringgit", value: "MYR" },
];

export default function GeneralSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [currency, setCurrency] = React.useState("INR");

  // Fetch current tenant settings
  React.useEffect(() => {
    async function fetchTenant() {
      try {
        const res = await fetch("/api/tenants");
        if (res.ok) {
          const { tenant } = await res.json();
          setName(tenant.name || "");
          setAddress(tenant.address || "");
          setTimezone(tenant.timezone || "Asia/Kolkata");
          setCurrency(tenant.currency || "INR");
        }
      } catch {
        toast("error", "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetchTenant();
  }, [toast]);

  async function handleSave() {
    if (!name.trim()) {
      toast("error", "Company name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, timezone, currency }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", "General settings saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save settings");
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
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Company Information</h2>

        <div className="space-y-4">
          <Input
            label="Company Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your company name"
          />

          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Address
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Company address"
              rows={3}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>

          <Select
            label="Timezone"
            options={TIMEZONES}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />

          <Select
            label="Currency"
            options={CURRENCIES}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} loading={saving}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
