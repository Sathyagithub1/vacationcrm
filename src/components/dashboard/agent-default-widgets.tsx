"use client";

import * as React from "react";
import Link from "next/link";
import {
  Users,
  Bell,
  Phone,
  Trophy,
  ArrowRight,
} from "lucide-react";

/**
 * Agent-focused default widgets.
 *
 * Rendered ONLY for AGENT-role users (gated by the caller in dashboard/page.tsx),
 * these give a new agent an immediately useful "my day" view on top of the
 * customisable widget grid.
 *
 * Every metric is pulled from a REAL existing endpoint, all of which already
 * hard-scope to the requesting agent server-side (role === "AGENT" ⇒
 * assignedTo = user.id). No client-side id juggling and no fabricated numbers —
 * if a source can't be read, the card shows "—".
 *
 *  • My open leads          → GET /api/leads?limit=1                     (total assigned to me)
 *  • My pending follow-ups  → GET /api/follow-ups?status=PENDING&limit=1 (total)
 *  • My callbacks due today → GET /api/callbacks?status=SCHEDULED        (client-side "today" filter on preferredTime)
 *  • My conversions (month) → GET /api/reports?type=agent-performance&dateFrom&dateTo (row.converted)
 */

type Stat = number | null; // null → source unreadable → render "—"

interface AgentStats {
  openLeads: Stat;
  pendingFollowUps: Stat;
  callbacksToday: Stat;
  conversionsThisMonth: Stat;
  loading: boolean;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}
function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

async function safeJson<T = unknown>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface LeadsResponse {
  total?: number;
}
interface FollowUpsResponse {
  total?: number;
}
interface CallbacksResponse {
  callbacks?: Array<{ preferredTime?: string | null }>;
}
interface AgentPerfResponse {
  rows?: Array<{ converted?: number }>;
}

async function fetchAgentStats(): Promise<AgentStats> {
  // /api/leads, /api/follow-ups and /api/callbacks all hard-scope to the
  // requesting agent server-side (role === "AGENT" ⇒ assignedTo = user.id),
  // so no client-side id filtering is needed.
  const [leads, followUps, callbacks, agentPerf] = await Promise.all([
    safeJson<LeadsResponse>("/api/leads?limit=1"),
    safeJson<FollowUpsResponse>("/api/follow-ups?status=PENDING&limit=1"),
    safeJson<CallbacksResponse>("/api/callbacks?status=SCHEDULED&limit=100"),
    safeJson<AgentPerfResponse>(
      `/api/reports?type=agent-performance&dateFrom=${firstOfMonthISO()}&dateTo=${todayISO()}`
    ),
  ]);

  // ── Open leads ────────────────────────────────────────────────────────
  // The agent's active book = every lead assigned to them (same real count
  // the sidebar "Leads" badge shows). `total` comes straight from the DB
  // count on the RBAC-scoped query.
  let openLeads: Stat = null;
  if (leads && typeof leads.total === "number") {
    openLeads = leads.total;
  }

  // ── Pending follow-ups ────────────────────────────────────────────────
  let pendingFollowUps: Stat = null;
  if (followUps && typeof followUps.total === "number") {
    pendingFollowUps = followUps.total;
  }

  // ── Callbacks due today ───────────────────────────────────────────────
  let callbacksToday: Stat = null;
  if (callbacks && Array.isArray(callbacks.callbacks)) {
    const from = startOfToday().getTime();
    const to = endOfToday().getTime();
    callbacksToday = callbacks.callbacks.filter((c) => {
      const t = c?.preferredTime ? new Date(c.preferredTime).getTime() : NaN;
      return !Number.isNaN(t) && t >= from && t <= to;
    }).length;
  }

  // ── Conversions this month ────────────────────────────────────────────
  // agent-performance auto-scopes to this agent (one row). `converted` is the
  // count of the agent's leads currently in a converted stage created within
  // the date window.
  let conversionsThisMonth: Stat = null;
  if (agentPerf && Array.isArray(agentPerf.rows)) {
    const row = agentPerf.rows[0];
    if (row && typeof row.converted === "number") {
      conversionsThisMonth = row.converted;
    } else if (agentPerf.rows.length === 0) {
      // No lead activity this month yet — a real, honest zero.
      conversionsThisMonth = 0;
    }
  }

  return {
    openLeads,
    pendingFollowUps,
    callbacksToday,
    conversionsThisMonth,
    loading: false,
  };
}

export function AgentDefaultWidgets() {
  const [stats, setStats] = React.useState<AgentStats>({
    openLeads: null,
    pendingFollowUps: null,
    callbacksToday: null,
    conversionsThisMonth: null,
    loading: true,
  });

  // All state updates happen in the promise callback (fetchAgentStats never rejects:
  // every request goes through safeJson, which resolves to null on failure).
  const load = React.useCallback(() => fetchAgentStats().then((next) => setStats(next)), []);

  React.useEffect(() => {
    load();
    const interval = setInterval(load, 120000); // refresh every 2 min
    return () => clearInterval(interval);
  }, [load]);

  const cards: Array<{
    label: string;
    value: Stat;
    hint: string;
    href: string;
    icon: typeof Users;
    accent: string;
  }> = [
    {
      label: "My Open Leads",
      value: stats.openLeads,
      hint: "Assigned to me, still in play",
      href: "/leads",
      icon: Users,
      accent: "text-primary-600 bg-primary-50",
    },
    {
      label: "My Pending Follow-ups",
      value: stats.pendingFollowUps,
      hint: "Awaiting your action",
      href: "/follow-ups",
      icon: Bell,
      accent: "text-amber-600 bg-amber-50",
    },
    {
      label: "My Callbacks Due Today",
      value: stats.callbacksToday,
      hint: "Scheduled for today",
      href: "/callbacks",
      icon: Phone,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "My Conversions This Month",
      value: stats.conversionsThisMonth,
      hint: "Won leads, month to date",
      href: "/reports",
      icon: Trophy,
      accent: "text-purple-600 bg-purple-50",
    },
  ];

  return (
    <section aria-label="My queue" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">My Queue</h2>
        <span className="text-xs text-gray-400">Your assigned work at a glance</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[112px] animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            ))
          : cards.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.label}
                  href={c.href}
                  className="group flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:shadow"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {c.label}
                    </p>
                    <p className="mt-1 truncate text-2xl font-bold text-gray-900">
                      {c.value === null ? "—" : c.value}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400 group-hover:text-primary-600">
                      {c.hint}
                      <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </p>
                  </div>
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${c.accent}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </Link>
              );
            })}
      </div>
    </section>
  );
}
