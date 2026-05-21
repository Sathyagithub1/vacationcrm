"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  fetchPublicBranding,
  tenantInitials,
  type PublicTenantBranding,
} from "@/lib/tenant-branding";

interface InviteInfo {
  email: string;
  role: string;
}

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [validating, setValidating] = useState(true);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [tokenError, setTokenError] = useState("");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState<PublicTenantBranding | null>(null);

  useEffect(() => {
    fetchPublicBranding().then(setBranding);
  }, []);

  const validateToken = useCallback(async () => {
    if (!token) {
      setTokenError("No invitation token provided.");
      setValidating(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/auth/accept-invite/validate?token=${encodeURIComponent(token)}`
      );
      const data = await res.json();

      if (data.valid) {
        setInviteInfo({ email: data.email, role: data.role });
      } else {
        setTokenError(data.error || "Invalid or expired invitation.");
      }
    } catch {
      setTokenError("Failed to validate invitation.");
    } finally {
      setValidating(false);
    }
  }, [token]);

  useEffect(() => {
    validateToken();
  }, [validateToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to accept invitation.");
        return;
      }

      router.push("/login?invited=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (validating) {
    return (
      <div className="flex flex-col items-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        <p className="mt-3 text-sm text-gray-500">Validating invitation...</p>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-6 w-6 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h2 className="text-lg font-medium text-gray-900">
          Invalid invitation
        </h2>
        <p className="mt-2 text-sm text-gray-500">{tokenError}</p>
        <p className="mt-1 text-sm text-gray-500">
          Contact your administrator for a new invitation.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-primary-500 hover:text-primary-600"
        >
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 text-center">
        {branding?.logoUrl ? (
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
          Accept your invitation
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          You&apos;ve been invited as{" "}
          <span className="font-medium text-gray-700">
            {inviteInfo?.role?.toLowerCase()}
          </span>{" "}
          for{" "}
          <span className="font-medium text-gray-700">{inviteInfo?.email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full name"
          type="text"
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />

        <Input
          label="Password"
          type="password"
          placeholder="Create a password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        <Input
          label="Confirm password"
          type="password"
          placeholder="Confirm your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
      </form>
    </div>
  );
}
