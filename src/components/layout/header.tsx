"use client";

import { Bell, Menu, LogOut, Settings, User } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown } from "@/components/ui/dropdown";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { data: session } = useSession();

  const userName = session?.user?.name || "User";

  const dropdownItems = [
    {
      label: "Profile",
      icon: <User className="h-4 w-4" />,
      onClick: () => {},
    },
    {
      label: "Settings",
      icon: <Settings className="h-4 w-4" />,
      onClick: () => {
        window.location.href = "/settings";
      },
    },
    {
      label: "Logout",
      icon: <LogOut className="h-4 w-4" />,
      danger: true,
      onClick: () => signOut({ callbackUrl: "/login" }),
    },
  ];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      {/* Left: hamburger on mobile */}
      <button
        onClick={onMenuClick}
        className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer for desktop */}
      <div className="hidden lg:block" />

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
          <Bell className="h-5 w-5" />
          {/* Badge — hardcoded 0 for now, Task 17 will wire it */}
        </button>

        {/* User avatar + dropdown */}
        <Dropdown
          trigger={
            <Avatar name={userName} size="sm" className="cursor-pointer" />
          }
          items={dropdownItems}
        />
      </div>
    </header>
  );
}
