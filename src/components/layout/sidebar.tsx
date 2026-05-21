"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Bell,
  Phone,
  Building2,
  UserCircle,
  Megaphone,
  BarChart3,
  UserCog,
  Settings,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTenant } from "@/hooks/use-tenant";
import { hasPermission } from "@/modules/auth/rbac";
import { SidebarNavItem } from "./sidebar-nav-item";
import type { Permission } from "@/types";
import type { Role } from "@prisma/client";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const bottomNavItems: Array<{ icon: typeof UserCog; label: string; href: string; permission?: Permission; permissionPrefix?: string }> = [
  { icon: UserCog, label: "Users", href: "/users", permission: "users:manage" },
  { icon: Settings, label: "Settings", href: "/settings", permissionPrefix: "settings:" },
];

// All settings permissions for prefix matching
const SETTINGS_PERMISSIONS: Permission[] = [
  "settings:general",
  "settings:branding",
  "settings:pipeline",
  "settings:notifications",
  "settings:integrations",
  "settings:billing",
];

function canViewItem(
  role: Role,
  item: { permission?: Permission; permissionPrefix?: string }
): boolean {
  if (item.permission) {
    return hasPermission(role, item.permission);
  }
  if (item.permissionPrefix) {
    return SETTINGS_PERMISSIONS.some(
      (p) => p.startsWith(item.permissionPrefix!) && hasPermission(role, p)
    );
  }
  return true; // no restriction
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { data: session } = useSession();
  const { tenant } = useTenant();
  const userRole = (session?.user?.role || "VIEWER") as Role;

  const [leadCount, setLeadCount] = useState(0);
  const [convoCount, setConvoCount] = useState(0);
  const [followUpCount, setFollowUpCount] = useState(0);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const [leadsRes, convosRes, followUpsRes] = await Promise.all([
          fetch("/api/leads?limit=1").then((r) => r.ok ? r.json() : null),
          fetch("/api/conversations?status=ACTIVE&limit=1").then((r) => r.ok ? r.json() : null),
          fetch("/api/follow-ups?status=PENDING&limit=1").then((r) => r.ok ? r.json() : null),
        ]);
        if (leadsRes) setLeadCount(leadsRes.total || 0);
        if (convosRes) setConvoCount(convosRes.total || 0);
        if (followUpsRes) setFollowUpCount(followUpsRes.total || 0);
      } catch {
        // silent — counts stay at 0
      }
    }
    fetchCounts();
    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, []);

  const mainNavItems: Array<{
    icon: typeof LayoutDashboard;
    label: string;
    href: string;
    badge?: number;
    badgeColor?: "orange" | "green" | "yellow";
    permission?: Permission;
  }> = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", permission: "dashboard:view" },
    { icon: Users, label: "Leads", href: "/leads", badge: leadCount, badgeColor: "orange", permission: "leads:view" },
    { icon: MessageSquare, label: "Conversations", href: "/conversations", badge: convoCount, badgeColor: "green", permission: "conversations:view" },
    { icon: Bell, label: "Follow-ups", href: "/follow-ups", badge: followUpCount, badgeColor: "yellow", permission: "follow-ups:view" },
    { icon: Phone, label: "Callbacks", href: "/callbacks", permission: "callbacks:view" },
    { icon: Building2, label: "Departments", href: "/departments", permission: "departments:manage" },
    { icon: UserCircle, label: "Customers", href: "/customers", permission: "customers:view" },
    { icon: Megaphone, label: "Broadcasts", href: "/broadcasts", permission: "broadcasts:send" },
    { icon: BarChart3, label: "Reports", href: "/reports", permission: "reports:view" },
  ];

  const visibleMainNav = mainNavItems.filter((item) => canViewItem(userRole, item));
  const visibleBottomNav = bottomNavItems.filter((item) => canViewItem(userRole, item));

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-md p-1 text-gray-400 hover:text-gray-600 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Tenant logo + name */}
        <div className="flex flex-col items-center gap-1 px-4 pb-4 pt-6">
          {tenant.logo ? (
            <img
              src={tenant.logo}
              alt={tenant.name}
              className="h-10 w-10 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 text-sm font-bold text-white">
              {tenant.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-semibold text-gray-800">
            {tenant.name}
          </span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-0.5">
            {visibleMainNav.map((item) => (
              <SidebarNavItem
                key={item.href}
                icon={item.icon}
                label={item.label}
                href={item.href}
                badge={item.badge}
                badgeColor={item.badgeColor}
              />
            ))}
          </div>

          {/* Divider */}
          {visibleBottomNav.length > 0 && (
            <div className="my-3 border-t border-gray-200" />
          )}

          {/* Bottom nav items */}
          <div className="space-y-0.5">
            {visibleBottomNav.map((item) => (
              <SidebarNavItem
                key={item.href}
                icon={item.icon}
                label={item.label}
                href={item.href}
              />
            ))}
          </div>
        </nav>
      </aside>
    </>
  );
}
