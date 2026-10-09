"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  X,
  Rocket,
  CreditCard,
  Mail,
  Building2,
  MapPinned,
  IndianRupee,
  PartyPopper,
} from "lucide-react";
import { useSession } from "next-auth/react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  title: string;
  description: string;
  icon: typeof CreditCard;
  cta: string;
  ctaHref: string;
  done: boolean;
}

const DISMISS_KEY = "hd-onboarding-dismissed";

const ADMIN_ROLES: Role[] = ["COMPANY_ADMIN", "SUPER_ADMIN"];

// ─── Live-signal fetching ─────────────────────────────────────────────────────

/**
 * Fetch the 5 real go-live signals. Each is fail-soft: a rejected/failed request
 * resolves to `false` (not-done) so a single flaky endpoint never fabricates
 * progress or crashes the card. Every done-state is derived from real API data.
 */
async function fetchSignals(): Promise<{
  razorpay: boolean;
  smtp: boolean;
  department: boolean;
  tour: boolean;
  payment: boolean;
}> {
  const [tenantRes, deptRes, tourRes, payRes] = await Promise.allSettled([
    fetch("/api/tenants"),
    fetch("/api/departments"),
    fetch("/api/tours?limit=1"),
    fetch("/api/payments?limit=1"),
  ]);

  async function jsonOf(
    r: PromiseSettledResult<Response>
  ): Promise<Record<string, unknown> | null> {
    if (r.status !== "fulfilled" || !r.value.ok) return null;
    try {
      return (await r.value.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const [tenant, depts, tours, pays] = await Promise.all([
    jsonOf(tenantRes),
    jsonOf(deptRes),
    jsonOf(tourRes),
    jsonOf(payRes),
  ]);

  // 1. Razorpay configured → tenant.razorpayKeyId present
  const t = (tenant?.tenant as Record<string, unknown>) ?? null;
  const razorpay = Boolean(t?.razorpayKeyId);

  // 2. SMTP configured → tenant.emailTemplateConfig.smtpHost present
  const emailConfig = (t?.emailTemplateConfig as Record<string, unknown>) ?? null;
  const smtpHost = emailConfig?.smtpHost;
  const smtp = typeof smtpHost === "string" && smtpHost.trim().length > 0;

  // 3. ≥1 department → departments array length
  const deptList = (depts?.departments as unknown[]) ?? [];
  const department = Array.isArray(deptList) && deptList.length > 0;

  // 4. ≥1 tour → total > 0
  const tour = typeof tours?.total === "number" && (tours.total as number) > 0;

  // 5. ≥1 payment → total > 0
  const payment = typeof pays?.total === "number" && (pays.total as number) > 0;

  return { razorpay, smtp, department, tour, payment };
}

function readStoredDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

// The dismiss flag is only read, never observed for cross-tab changes.
function subscribeNoop(): () => void {
  return () => {};
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingChecklist() {
  const { data: session } = useSession();
  const role = (session?.user?.role || "VIEWER") as Role;
  const isAdmin = ADMIN_ROLES.includes(role);

  const [steps, setSteps] = React.useState<Step[] | null>(null);

  // Read the client-side dismiss flag once mounted (avoids SSR/localStorage mismatch):
  // the server snapshot is null (not mounted yet → assume hidden), the client
  // snapshot is the stored flag.
  const storedDismissed = React.useSyncExternalStore<boolean | null>(
    subscribeNoop,
    readStoredDismissed,
    () => null
  );
  const mounted = storedDismissed !== null;
  const [dismissedByUser, setDismissed] = React.useState(false);
  const dismissed = storedDismissed !== false || dismissedByUser;

  // Fetch the live signals only for admins who haven't dismissed.
  React.useEffect(() => {
    if (!mounted || !isAdmin || dismissed) return;

    let active = true;
    (async () => {
      const s = await fetchSignals();
      if (!active) return;
      setSteps([
        {
          key: "razorpay",
          title: "Connect a payment gateway",
          description: "Add your Razorpay keys so you can accept payments from customers.",
          icon: CreditCard,
          cta: "Set up Razorpay",
          ctaHref: "/settings/integrations",
          done: s.razorpay,
        },
        {
          key: "smtp",
          title: "Set up email (SMTP)",
          description: "Configure an SMTP host to send confirmations and quotes to leads.",
          icon: Mail,
          cta: "Configure email",
          ctaHref: "/settings/integrations",
          done: s.smtp,
        },
        {
          key: "department",
          title: "Create a department",
          description: "Organize your team and route leads by creating your first department.",
          icon: Building2,
          cta: "Add a department",
          ctaHref: "/departments",
          done: s.department,
        },
        {
          key: "tour",
          title: "Add tour inventory",
          description: "Publish at least one tour so your team can sell and take bookings.",
          icon: MapPinned,
          cta: "Add a tour",
          ctaHref: "/settings/tours",
          done: s.tour,
        },
        {
          key: "payment",
          title: "Take your first payment",
          description: "Collect a payment from a lead to complete your first live booking.",
          icon: IndianRupee,
          cta: "Go to leads",
          ctaHref: "/leads",
          done: s.payment,
        },
      ]);
    })();

    return () => {
      active = false;
    };
  }, [mounted, isAdmin, dismissed]);

  const doneCount = steps ? steps.filter((s) => s.done).length : 0;
  const total = steps?.length ?? 0;
  const allComplete = steps !== null && total > 0 && doneCount === total;

  // Auto-hide permanently once everything is complete: persist the dismiss flag
  // so the checklist never reappears after the operator finishes go-live.
  React.useEffect(() => {
    if (allComplete) {
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  }, [allComplete]);

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  // Gate: admins only, not dismissed, signals loaded, and not fully complete.
  if (!mounted || !isAdmin || dismissed) return null;
  if (!steps) return null; // still loading — don't flash a partial card
  if (allComplete) return null; // auto-hide once go-live is done

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <section
      aria-label="Getting started checklist"
      className="relative mt-6 overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm"
    >
      {/* Accent gradient rail */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600" />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gradient-to-br from-primary-50/60 to-white px-6 pb-5 pt-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white shadow-sm shadow-primary-500/30">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-gray-900">
              Getting started
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Finish these steps to take your CRM live and start collecting bookings.
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="Dismiss checklist"
          aria-label="Dismiss checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress */}
      <div className="px-6 pt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">
            {doneCount} of {total} complete
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
            <PartyPopper className="h-3.5 w-3.5" />
            {pct}%
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-600 transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ol className="divide-y divide-gray-100 px-2 py-3">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={cn(
                "group flex items-center gap-4 rounded-xl px-4 py-3.5 transition-colors",
                step.done ? "opacity-70" : "hover:bg-gray-50"
              )}
            >
              {/* Status icon */}
              <div className="flex-shrink-0">
                {step.done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                ) : (
                  <Circle className="h-6 w-6 text-gray-300" />
                )}
              </div>

              {/* Feature icon + text */}
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <div
                  className={cn(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
                    step.done
                      ? "bg-emerald-50 text-emerald-500"
                      : "bg-primary-50 text-primary-600"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-semibold text-gray-900",
                      step.done && "line-through decoration-gray-300"
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="truncate text-xs text-gray-500">{step.description}</p>
                </div>
              </div>

              {/* CTA */}
              <div className="flex-shrink-0">
                {step.done ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                    Done
                  </span>
                ) : (
                  <Link
                    href={step.ctaHref}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-600 active:bg-primary-700"
                  >
                    {step.cta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
