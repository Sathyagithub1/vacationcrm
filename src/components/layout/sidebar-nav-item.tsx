"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: number;
  badgeColor?: "orange" | "green" | "yellow";
}

const badgeColorClasses = {
  orange: "bg-primary-500 text-white",
  green: "bg-green-500 text-white",
  yellow: "bg-yellow-500 text-white",
};

export function SidebarNavItem({
  icon: Icon,
  label,
  href,
  badge,
  badgeColor = "orange",
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-r-lg px-4 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "border-l-3 border-primary-500 bg-primary-50 text-primary-500"
          : "border-l-3 border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold",
            badgeColorClasses[badgeColor]
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
