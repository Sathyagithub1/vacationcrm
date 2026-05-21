"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemePreset {
  name: string;
  primary: string;
  secondary: string;
}

const THEME_PRESETS: ThemePreset[] = [
  { name: "Sunset Orange", primary: "#FF6B35", secondary: "#FF9F1C" },
  { name: "Royal Indigo", primary: "#6C63FF", secondary: "#3F51B5" },
  { name: "Ocean Blue", primary: "#00B4D8", secondary: "#0077B6" },
  { name: "Tropical Green", primary: "#00C853", secondary: "#00BFA5" },
  { name: "Ruby Red", primary: "#E91E63", secondary: "#FF5252" },
  { name: "Slate", primary: "#475569", secondary: "#334155" },
];

export default function BrandingSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [productName, setProductName] = React.useState("Holiday Delight CRM");
  const [primaryColor, setPrimaryColor] = React.useState("#FF6B35");
  const [secondaryColor, setSecondaryColor] = React.useState("#FF9F1C");
  const [selectedPreset, setSelectedPreset] = React.useState<string | null>("Sunset Orange");

  // File state
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = React.useState<string | null>(null);
  const [loginBgUrl, setLoginBgUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);

  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const faviconInputRef = React.useRef<HTMLInputElement>(null);
  const loginBgInputRef = React.useRef<HTMLInputElement>(null);

  // Fetch tenant branding
  React.useEffect(() => {
    async function fetchTenant() {
      try {
        const res = await fetch("/api/tenants");
        if (res.ok) {
          const { tenant } = await res.json();
          setProductName(tenant.productName || "Holiday Delight CRM");
          setLogoUrl(tenant.logoUrl || null);
          setFaviconUrl(tenant.faviconUrl || null);
          setLoginBgUrl(tenant.loginBgUrl || null);

          // Parse theme config
          const theme = tenant.themeConfig as Record<string, unknown> | null;
          if (theme) {
            setPrimaryColor((theme.primaryColor as string) || "#FF6B35");
            setSecondaryColor((theme.secondaryColor as string) || "#FF9F1C");
            setSelectedPreset((theme.presetName as string) || null);
          }
        }
      } catch {
        toast("error", "Failed to load branding settings");
      } finally {
        setLoading(false);
      }
    }
    fetchTenant();
  }, [toast]);

  // Handle preset selection
  function handlePresetClick(preset: ThemePreset) {
    setSelectedPreset(preset.name);
    setPrimaryColor(preset.primary);
    setSecondaryColor(preset.secondary);
  }

  // Handle custom color change
  function handlePrimaryChange(color: string) {
    setPrimaryColor(color);
    setSelectedPreset("Custom");
  }

  function handleSecondaryChange(color: string) {
    setSecondaryColor(color);
    setSelectedPreset("Custom");
  }

  // File upload
  async function handleFileUpload(
    file: File,
    type: "logo" | "favicon" | "loginBg"
  ) {
    setUploading(type);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);

      const res = await fetch("/api/tenants/branding", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const { url } = await res.json();

      if (type === "logo") setLogoUrl(url);
      if (type === "favicon") setFaviconUrl(url);
      if (type === "loginBg") setLoginBgUrl(url);

      toast("success", `${type === "loginBg" ? "Login background" : type.charAt(0).toUpperCase() + type.slice(1)} uploaded`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>,
    type: "logo" | "favicon" | "loginBg"
  ) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, type);
    e.target.value = "";
  }

  // Save branding settings (product name + theme colors)
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          primaryColor,
          secondaryColor,
          presetName: selectedPreset,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", "Branding settings saved");

      // Apply colors to the page immediately
      const root = document.documentElement;
      root.style.setProperty("--tenant-primary", primaryColor);
      root.style.setProperty("--tenant-primary-light", secondaryColor);
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
    <div className="max-w-3xl space-y-6">
      {/* Product Name */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Product Name</h2>
        <Input
          label="Name shown in sidebar, title bar, and emails"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Holiday Delight CRM"
        />
      </div>

      {/* Logo & Favicon */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Logo & Favicon</h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Logo */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Logo</label>
            <div className="flex items-start gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-full w-full rounded-lg object-contain" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => logoInputRef.current?.click()}
                  loading={uploading === "logo"}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Logo
                </Button>
                <p className="text-xs text-gray-400">PNG, JPG, SVG. Max 5MB.</p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, "logo")}
                />
              </div>
            </div>
          </div>

          {/* Favicon */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Favicon</label>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                {faviconUrl ? (
                  <img src={faviconUrl} alt="Favicon" className="h-full w-full rounded-lg object-contain" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-gray-300" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => faviconInputRef.current?.click()}
                  loading={uploading === "favicon"}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Favicon
                </Button>
                <p className="text-xs text-gray-400">ICO, PNG. Max 5MB.</p>
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/x-icon,image/png,image/svg+xml"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, "favicon")}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Color Theme */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Color Theme</h2>

        {/* Preset circles */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">Presets</label>
          <div className="flex flex-wrap gap-3">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className={cn(
                  "flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-all",
                  selectedPreset === preset.name
                    ? "border-gray-900 bg-gray-50 text-gray-900"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                )}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: preset.primary }}
                />
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: preset.secondary }}
                />
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedPreset("Custom")}
              className={cn(
                "flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-all",
                selectedPreset === "Custom"
                  ? "border-gray-900 bg-gray-50 text-gray-900"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              )}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Color pickers */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ColorPicker
            label="Primary Color"
            value={primaryColor}
            onChange={handlePrimaryChange}
          />
          <ColorPicker
            label="Secondary Color"
            value={secondaryColor}
            onChange={handleSecondaryChange}
          />
        </div>

        {/* Live preview */}
        <div className="mt-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">Preview</label>
          <div className="flex items-center gap-4 rounded-lg border border-gray-200 p-4">
            <div
              className="flex h-10 items-center rounded-md px-4 text-sm font-medium text-white"
              style={{ backgroundColor: primaryColor }}
            >
              Primary Button
            </div>
            <div
              className="flex h-10 items-center rounded-md border-2 px-4 text-sm font-medium"
              style={{ borderColor: secondaryColor, color: secondaryColor }}
            >
              Secondary
            </div>
            <div
              className="h-8 w-8 rounded-full"
              style={{ backgroundColor: primaryColor }}
            />
            <div
              className="h-8 w-8 rounded-full"
              style={{ backgroundColor: secondaryColor }}
            />
          </div>
        </div>
      </div>

      {/* Login Background */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Login Background</h2>
        <div className="flex items-start gap-4">
          <div className="flex h-32 w-48 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
            {loginBgUrl ? (
              <img src={loginBgUrl} alt="Login background" className="h-full w-full object-cover" />
            ) : (
              <div className="text-center">
                <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-1 text-xs text-gray-400">No image</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => loginBgInputRef.current?.click()}
              loading={uploading === "loginBg"}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Background
            </Button>
            <p className="text-xs text-gray-400">
              Recommended: 1920x1080. PNG, JPG. Max 5MB.
            </p>
            <input
              ref={loginBgInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleFileSelect(e, "loginBg")}
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pb-8">
        <Button onClick={handleSave} loading={saving}>
          Save Branding
        </Button>
      </div>
    </div>
  );
}
