"use client";

import { useEffect, useState } from "react";

export interface TenantConfig {
  name: string;
  logo: string | null;
  productName: string;
  primaryColor: string;
  primaryLight: string;
  loginBackground: string | null;
}

const defaultTenant: TenantConfig = {
  name: "Holiday Delight",
  logo: null,
  productName: "Holiday Delight CRM",
  primaryColor: "#FF6B35",
  primaryLight: "#FFF3E0",
  loginBackground: null,
};

export function useTenant() {
  const [tenant, setTenant] = useState<TenantConfig>(defaultTenant);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Will be wired to API in Task 24
    // For now, apply hardcoded defaults
    const root = document.documentElement;
    root.style.setProperty("--tenant-primary", tenant.primaryColor);
    root.style.setProperty("--tenant-primary-light", tenant.primaryLight);
  }, [tenant]);

  return { tenant, loading };
}
