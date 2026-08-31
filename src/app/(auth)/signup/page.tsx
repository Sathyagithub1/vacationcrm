"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  fetchPublicBranding,
  tenantInitials,
  type PublicTenantBranding,
} from "@/lib/tenant-branding";

// Public flag mirrors the server-side SIGNUP_ENABLED. When this is not "true"
// (the default), the page shows a "Signups are currently closed" state and does
// NOT render a working form — matching the server's 403.
const SIGNUP_ENABLED = process.env.NEXT_PUBLIC_SIGNUP_ENABLED === "true";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<PublicTenantBranding | null>(null);

  useEffect(() => {
    fetchPublicBranding().then(setBranding);
  }, []);

  const Header = (
    <div className="mb-8 text-center">
      {branding?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt={branding.name}
          className="mx-auto mb-3 h-12 w-12 rounded-xl object-contain"
        />
      ) : (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500 text-xl font-bold text-white">
          {branding ? tenantInitials(branding.name) : ""}
        </div>
      )}
      <h1 className="text-xl font-semibold text-gray-900">
        {branding?.productName ?? "CRM"}
      </h1>
      <p className="mt-1 text-sm text-gray-500">Create your workspace</p>
    </div>
  );

  // Flag OFF — closed state, no working form.
  if (!SIGNUP_ENABLED) {
    return (
      <div>
        {Header}
        <div className="rounded-md bg-gray-50 p-4 text-center text-sm text-gray-600">
          Signups are currently closed.
        </div>
        <div className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-primary-500 hover:text-primary-600">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, adminName, email, password }),
      });

      if (res.ok) {
        router.push("/login?signup=success");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setError("Signups are currently closed.");
      } else if (res.status === 409) {
        setError(data.error || "That workspace or email is already taken.");
      } else {
        setError(data.error || "Could not create your workspace. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {Header}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Company name"
          type="text"
          placeholder="Acme Travels"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
          autoComplete="organization"
        />

        <Input
          label="Your name"
          type="text"
          placeholder="Jane Doe"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          required
          autoComplete="name"
        />

        <Input
          label="Work email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Create workspace
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="text-primary-500 hover:text-primary-600">
          Sign in
        </Link>
      </div>
    </div>
  );
}
