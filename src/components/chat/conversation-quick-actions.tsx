"use client";

import * as React from "react";
import { PhoneCall, Slash, Zap, Clock, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Minimal shape the quick-actions bar needs from the selected conversation. */
export interface QuickActionsContext {
  leadId: string;
  departmentId: string | null;
  customerName: string;
}

interface CannedResponse {
  id: string;
  title: string;
  content: string;
  shortcut: string;
}

interface ConversationQuickActionsProps {
  /** Null when no conversation is selected or its lead/department is unavailable. */
  context: QuickActionsContext | null;
  /** True when the conversation is closed — disables all quick actions. */
  disabled?: boolean;
  /** Canned responses fetched by the page from /api/canned-responses. */
  cannedResponses: CannedResponse[];
  /**
   * Send a message into the thread. Used when the operator picks a canned
   * response from the "/" command menu.
   */
  onSendMessage: (content: string) => void;
}

/** Quick-callback presets. Each returns a fresh Date at click time. */
const CALLBACK_PRESETS: { label: string; build: () => Date }[] = [
  {
    label: "In 1 hour",
    build: () => new Date(Date.now() + 60 * 60 * 1000),
  },
  {
    label: "In 3 hours",
    build: () => new Date(Date.now() + 3 * 60 * 60 * 1000),
  },
  {
    label: "Tomorrow 10 AM",
    build: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d;
    },
  },
];

function toLocalInputValue(d: Date): string {
  // Format a Date as the value expected by <input type="datetime-local">.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function ConversationQuickActions({
  context,
  disabled,
  cannedResponses,
  onSendMessage,
}: ConversationQuickActionsProps) {
  const { toast } = useToast();

  // "/" command menu
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const menuInputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Custom callback modal
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customTime, setCustomTime] = React.useState("");
  const [customNotes, setCustomNotes] = React.useState("");

  // Prevent double-submits while a callback is being created.
  const [scheduling, setScheduling] = React.useState(false);

  const canAct = !!context && !!context.departmentId && !disabled;

  // --- Callback creation (real API) -------------------------------------
  const scheduleCallback = React.useCallback(
    async (preferredTime: Date, notes?: string) => {
      if (!context || !context.departmentId) {
        toast("error", "This lead has no department; cannot schedule a callback.");
        return false;
      }
      setScheduling(true);
      try {
        const res = await fetch("/api/callbacks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: context.leadId,
            departmentId: context.departmentId,
            preferredTime: preferredTime.toISOString(),
            notes: notes?.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to schedule callback");
        }
        toast(
          "success",
          `Callback scheduled for ${preferredTime.toLocaleString()}`
        );
        return true;
      } catch (err) {
        toast(
          "error",
          err instanceof Error ? err.message : "Failed to schedule callback"
        );
        return false;
      } finally {
        setScheduling(false);
      }
    },
    [context, toast]
  );

  // --- "/" command menu items -------------------------------------------
  // Built from a fixed "/callback" action plus every canned response.
  type CommandItem =
    | { kind: "callback"; key: string; label: string; hint: string }
    | { kind: "canned"; key: string; label: string; hint: string; content: string };

  const allCommands: CommandItem[] = React.useMemo(() => {
    const items: CommandItem[] = [
      {
        kind: "callback",
        key: "cmd-callback",
        label: "/callback",
        hint: "Schedule a callback for this lead",
      },
    ];
    for (const cr of cannedResponses) {
      items.push({
        kind: "canned",
        key: `cr-${cr.id}`,
        label: `/${cr.shortcut}`,
        hint: cr.title,
        content: cr.content,
      });
    }
    return items;
  }, [cannedResponses]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.hint.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Keep the highlighted row valid as the filter changes.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, menuOpen]);

  // Focus the search field when the menu opens.
  React.useEffect(() => {
    if (menuOpen) {
      // defer so the input is mounted
      const t = setTimeout(() => menuInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [menuOpen]);

  // Close the menu on outside click.
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function runCommand(item: CommandItem) {
    if (item.kind === "callback") {
      setMenuOpen(false);
      setQuery("");
      setCustomTime(toLocalInputValue(CALLBACK_PRESETS[0].build()));
      setCustomNotes("");
      setCustomOpen(true);
      return;
    }
    // canned response -> send into the thread
    setMenuOpen(false);
    setQuery("");
    onSendMessage(item.content);
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) runCommand(item);
    }
  }

  async function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customTime) {
      toast("error", "Pick a callback time");
      return;
    }
    const when = new Date(customTime);
    if (Number.isNaN(when.getTime())) {
      toast("error", "Invalid callback time");
      return;
    }
    const ok = await scheduleCallback(when, customNotes);
    if (ok) {
      setCustomOpen(false);
      setCustomNotes("");
    }
  }

  // Nothing to render when no conversation is selected.
  if (!context) return null;

  return (
    <div
      ref={containerRef}
      className="relative border-b border-gray-100 bg-gray-50/60 px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          <PhoneCall className="h-3 w-3" />
          Callback
        </span>

        {/* Quick-schedule preset chips (real POST /api/callbacks) */}
        {CALLBACK_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={!canAct || scheduling}
            onClick={() => scheduleCallback(preset.build())}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
            title={
              canAct
                ? `Schedule callback ${preset.label.toLowerCase()}`
                : "Callback unavailable"
            }
          >
            <Clock className="h-3 w-3" />
            {preset.label}
          </button>
        ))}

        {/* Custom time chip -> modal */}
        <button
          type="button"
          disabled={!canAct || scheduling}
          onClick={() => {
            setCustomTime(toLocalInputValue(CALLBACK_PRESETS[0].build()));
            setCustomNotes("");
            setCustomOpen(true);
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          Custom…
        </button>

        {/* "/" command launcher */}
        <div className="ml-auto">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              menuOpen
                ? "bg-primary-100 text-primary-700"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
            title="Slash commands (/)"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
          >
            <Slash className="h-3.5 w-3.5" />
            Commands
          </button>
        </div>
      </div>

      {!context.departmentId && (
        <p className="mt-1 text-[11px] text-amber-600">
          This lead has no department assigned — callbacks are disabled.
        </p>
      )}

      {/* "/" command menu */}
      {menuOpen && (
        <div
          role="listbox"
          className="absolute right-4 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="border-b border-gray-100 p-2">
            <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2">
              <Slash className="h-3.5 w-3.5 text-gray-400" />
              <input
                ref={menuInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleMenuKeyDown}
                placeholder="Type a command…  (Esc to close)"
                className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                No matching commands
              </div>
            ) : (
              filtered.map((item, idx) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={idx === activeIndex}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => runCommand(item)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                    idx === activeIndex ? "bg-primary-50" : "hover:bg-gray-50"
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {item.kind === "callback" ? (
                      <PhoneCall className="h-3.5 w-3.5 text-primary-600" />
                    ) : (
                      <Zap className="h-3.5 w-3.5 text-gray-400" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-gray-800">
                        {item.label}
                      </span>
                      {item.kind === "callback" && (
                        <Badge variant="primary" size="sm">
                          action
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {item.hint}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Custom callback modal */}
      <Modal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Schedule callback"
      >
        <form onSubmit={handleCustomSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Schedule a callback for{" "}
            <span className="font-medium text-gray-700">
              {context.customerName || "this lead"}
            </span>
            .
          </p>
          <div>
            <label
              htmlFor="callback-time"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Preferred time
            </label>
            <input
              id="callback-time"
              type="datetime-local"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <Input
            label="Notes (optional)"
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            placeholder="Reason / context for the callback"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCustomOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={scheduling}>
              <Check className="h-4 w-4" />
              Schedule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
