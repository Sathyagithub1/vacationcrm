"use client";

import * as React from "react";
import { Bell, Menu, LogOut, Settings, User, Search, X, Users, MessageSquare, Briefcase } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown } from "@/components/ui/dropdown";

interface HeaderProps {
  onMenuClick: () => void;
}

interface SearchResultGroup {
  customers: Array<{ id: string; name: string; mobile: string; email: string | null }>;
  leads: Array<{ id: string; customer: { name: string }; department: { name: string }; stage: { name: string } }>;
  conversations: Array<{ id: string; status: string; lead: { customer: { name: string } } }>;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { data: session } = useSession();
  const router = useRouter();

  const userName = session?.user?.name || "User";

  // Search state
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResultGroup | null>(null);
  const [searching, setSearching] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Debounced search
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery || searchQuery.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Close on Escape
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
        setResults(null);
      }
      // Ctrl+K or Cmd+K to open search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close on click outside
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setResults(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleResultClick(href: string) {
    setSearchOpen(false);
    setSearchQuery("");
    setResults(null);
    router.push(href);
  }

  const hasResults = results && (
    results.customers.length > 0 ||
    results.leads.length > 0 ||
    results.conversations.length > 0
  );

  const noResults = results && !hasResults && searchQuery.length >= 2;

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

      {/* Center: Search bar */}
      <div className="relative mx-4 flex-1 max-w-md" ref={dropdownRef}>
        {searchOpen ? (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers, leads, conversations..."
              className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-8 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
              autoFocus
            />
            <button
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
                setResults(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setSearchOpen(true);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-400 hover:border-gray-300 hover:bg-white"
          >
            <Search className="h-4 w-4" />
            <span>Search...</span>
            <kbd className="ml-auto hidden rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-400 lg:inline-block">
              Ctrl+K
            </kbd>
          </button>
        )}

        {/* Search results dropdown */}
        {searchOpen && (hasResults || noResults || searching) && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {searching && (
              <div className="px-4 py-3 text-center text-sm text-gray-400">
                Searching...
              </div>
            )}

            {noResults && !searching && (
              <div className="px-4 py-3 text-center text-sm text-gray-500">
                No results found for &quot;{searchQuery}&quot;
              </div>
            )}

            {hasResults && !searching && (
              <>
                {/* Customers */}
                {results.customers.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
                      <Users className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs font-medium uppercase text-gray-400">
                        Customers
                      </span>
                    </div>
                    {results.customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleResultClick(`/customers`)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">{c.name}</p>
                          <p className="truncate text-xs text-gray-500">
                            {c.mobile}{c.email ? ` | ${c.email}` : ""}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Leads */}
                {results.leads.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
                      <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs font-medium uppercase text-gray-400">
                        Leads
                      </span>
                    </div>
                    {results.leads.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => handleResultClick(`/leads`)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-50 text-green-600">
                          <Briefcase className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">{l.customer.name}</p>
                          <p className="truncate text-xs text-gray-500">
                            {l.department.name} | {l.stage.name}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Conversations */}
                {results.conversations.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
                      <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs font-medium uppercase text-gray-400">
                        Conversations
                      </span>
                    </div>
                    {results.conversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleResultClick(`/conversations`)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-50 text-purple-600">
                          <MessageSquare className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {conv.lead.customer.name}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            Status: {conv.status}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

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
