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

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" role="tablist">
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
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary-500 text-primary-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  );
}
