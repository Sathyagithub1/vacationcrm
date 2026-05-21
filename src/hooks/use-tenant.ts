"use client";

import { useEffect, useState } from "react";

export interface TenantConfig {
  name: string;
  logo: string | null;
  favicon: string | null;
  productName: string;
  primaryColor: string;
  secondaryColor: string;
  primaryLight: string;
  loginBackground: string | null;
  timezone: string;
  currency: string;
  address: string | null;
}

const defaultTenant: TenantConfig = {
  name: "CRM",
  logo: null,
  favicon: null,
  productName: "CRM",
  primaryColor: "#FF6B35",
  secondaryColor: "#FF9F1C",
  primaryLight: "#FFF3E0",
  loginBackground: null,
  timezone: "Asia/Kolkata",
  currency: "INR",
  address: null,
};

export function useTenant() {
  const [tenant, setTenant] = useState<TenantConfig>(defaultTenant);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTenant() {
      try {
        const res = await fetch("/api/tenants");
        if (res.ok) {
          const { tenant: data } = await res.json();
          const theme = (data.themeConfig || {}) as Record<string, unknown>;

          const config: TenantConfig = {
            name: data.name || defaultTenant.name,
            logo: data.logoUrl || null,
            favicon: data.faviconUrl || null,
            productName: data.productName || defaultTenant.productName,
            primaryColor: (theme.primaryColor as string) || defaultTenant.primaryColor,
            secondaryColor: (theme.secondaryColor as string) || defaultTenant.secondaryColor,
            primaryLight: defaultTenant.primaryLight,
            loginBackground: data.loginBgUrl || null,
            timezone: data.timezone || defaultTenant.timezone,
            currency: data.currency || defaultTenant.currency,
            address: data.address || null,
          };

          setTenant(config);

          // Apply CSS variables dynamically
          const root = document.documentElement;
          root.style.setProperty("--tenant-primary", config.primaryColor);
          root.style.setProperty("--tenant-primary-light", config.primaryLight);
          root.style.setProperty("--tenant-secondary", config.secondaryColor);

          // Apply full palette if present
          const variables = theme.variables as Record<string, string> | undefined;
          if (variables) {
            for (const [key, value] of Object.entries(variables)) {
              root.style.setProperty(key, value);
            }
          }

          // Update page title
          document.title = config.productName;

          // Update favicon if set
          if (config.favicon) {
            let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
            if (!link) {
              link = document.createElement("link");
              link.rel = "icon";
              document.head.appendChild(link);
            }
            link.href = config.favicon;
          }
        }
      } catch {
        // Use defaults on failure
      } finally {
        setLoading(false);
      }
    }

    fetchTenant();
  }, []);

  // Re-apply CSS vars whenever tenant changes
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tenant-primary", tenant.primaryColor);
    root.style.setProperty("--tenant-primary-light", tenant.primaryLight);
  }, [tenant]);

  return { tenant, loading };
}
