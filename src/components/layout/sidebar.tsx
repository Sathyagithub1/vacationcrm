"use client";

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
import { useTenant } from "@/hooks/use-tenant";
import { SidebarNavItem } from "./sidebar-nav-item";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const mainNavItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Users, label: "Leads", href: "/leads", badge: 0, badgeColor: "orange" as const },
  { icon: MessageSquare, label: "Conversations", href: "/conversations", badge: 0, badgeColor: "green" as const },
  { icon: Bell, label: "Follow-ups", href: "/follow-ups", badge: 0, badgeColor: "yellow" as const },
  { icon: Phone, label: "Callbacks", href: "/callbacks" },
  { icon: Building2, label: "Departments", href: "/departments" },
  { icon: UserCircle, label: "Customers", href: "/customers" },
  { icon: Megaphone, label: "Broadcasts", href: "/broadcasts" },
  { icon: BarChart3, label: "Reports", href: "/reports" },
];

const bottomNavItems = [
  { icon: UserCog, label: "Users", href: "/users" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const { tenant } = useTenant();

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
              HD
            </div>
          )}
          <span className="text-sm font-semibold text-gray-800">
            {tenant.name}
          </span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-0.5">
            {mainNavItems.map((item) => (
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
          <div className="my-3 border-t border-gray-200" />

          {/* Bottom nav items */}
          <div className="space-y-0.5">
            {bottomNavItems.map((item) => (
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
