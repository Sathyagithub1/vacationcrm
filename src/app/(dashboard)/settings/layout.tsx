"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Settings,
  Palette,
  Building2,
  GitBranch,
  Bell,
  Plug,
  ScrollText,
  Brain,
  BookOpen,
  Radio,
  MessageSquare,
  BarChart3,
} from "lucide-react";

const settingsTabs = [
  { label: "General", href: "/settings/general", icon: Settings },
  { label: "Branding", href: "/settings/branding", icon: Palette },
  { label: "Departments", href: "/settings/departments", icon: Building2 },
  { label: "Pipeline", href: "/settings/pipeline", icon: GitBranch },
  { label: "Notifications", href: "/settings/notifications", icon: Bell },
  { label: "Integrations", href: "/settings/integrations", icon: Plug },
  { label: "AI Config", href: "/settings/ai", icon: Brain },
  { label: "Knowledge Base", href: "/settings/knowledge-base", icon: BookOpen },
  { label: "Channels", href: "/settings/channels", icon: Radio },
  { label: "Widget", href: "/settings/widget", icon: MessageSquare },
  { label: "Analytics", href: "/settings/analytics", icon: BarChart3 },
  { label: "Audit Log", href: "/settings/audit", icon: ScrollText },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Settings</h1>
        <p className="mt-0.5 text-xs text-gray-500">Manage your CRM configuration</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Vertical settings nav — fixed-width sidebar on desktop, horizontal scroll on mobile */}
        <nav
          role="tablist"
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1.5 lg:w-56 lg:flex-col lg:overflow-visible"
        >
          {settingsTabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-50 text-primary-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary-500")} />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {/* Content panel */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
