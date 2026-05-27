"use client";

/**
 * MarkAsSpamModal
 *
 * Shown from a conversation detail page. Lets the user mark a conversation
 * (and optionally its sender) as spam.
 *
 * Two multi-selects:
 *  - Channels   — pre-filled with the conversation's channel(s)
 *  - Departments — pre-filled with the lead's department
 *
 * On confirm, calls POST /api/conversations/:id/mark-spam.
 *
 * Props:
 *   conversationId  — ID of the conversation to mark
 *   senderChannels  — channels already associated with the sender (pre-fill)
 *   leadDeptId      — department ID of the lead (pre-fill in department select)
 *   open            — modal visibility
 *   onClose         — close callback
 *   onMarked        — called after successful mark
 */

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const ALL_CHANNELS = [
  "whatsapp",
  "email",
  "instagram",
  "facebook",
  "website",
  "sms",
  "telegram",
];

interface Department {
  id: string;
  name: string;
}

interface MarkAsSpamModalProps {
  conversationId: string;
  senderChannels?: string[];
  leadDeptId?:     string | null;
  open:            boolean;
  onClose:         () => void;
  onMarked?:       () => void;
}

export function MarkAsSpamModal({
  conversationId,
  senderChannels = [],
  leadDeptId,
  open,
  onClose,
  onMarked,
}: MarkAsSpamModalProps) {
  const { toast } = useToast();

  const [selectedChannels, setSelectedChannels] = React.useState<string[]>(senderChannels);
  const [selectedDepts,    setSelectedDepts]    = React.useState<string[]>(
    leadDeptId ? [leadDeptId] : []
  );
  const [depts,    setDepts]    = React.useState<Department[]>([]);
  const [loadingDepts, setLoadingDepts] = React.useState(true);
  const [submitting,   setSubmitting]   = React.useState(false);

  // Re-init pre-fills when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedChannels(senderChannels);
      setSelectedDepts(leadDeptId ? [leadDeptId] : []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    async function fetchDepts() {
      setLoadingDepts(true);
      try {
        const res = await fetch("/api/departments?limit=100");
        if (res.ok) {
          const data: { departments?: Department[] } = await res.json();
          setDepts(data.departments ?? []);
        }
      } catch {
        // silent — dept list stays empty
      } finally {
        setLoadingDepts(false);
      }
    }
    fetchDepts();
  }, []);

  function toggleChannel(ch: string) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  function toggleDept(id: string) {
    setSelectedDepts((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/mark-spam`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          channels:      selectedChannels,
          departmentIds: selectedDepts,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to mark as spam");
      }
      toast("success", "Conversation marked as spam");
      onClose();
      onMarked?.();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to mark as spam");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mark as Spam">
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          This will flag the conversation and optionally create or update blacklist rules
          for the selected channels and departments.
        </p>

        {/* Channels multi-select */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Block on channels</p>
          <div className="flex flex-wrap gap-2">
            {ALL_CHANNELS.map((ch) => {
              const isSelected = selectedChannels.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors capitalize",
                    isSelected
                      ? "border-red-500 bg-red-50 text-red-700"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  )}
                >
                  {ch}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400">
            {selectedChannels.length === 0
              ? "No channels selected — spam rule will not create a blacklist entry"
              : `Will apply to: ${selectedChannels.join(", ")}`}
          </p>
        </div>

        {/* Departments multi-select */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Scope to departments</p>
          {loadingDepts ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Spinner size="sm" /> Loading…
            </div>
          ) : depts.length === 0 ? (
            <p className="text-xs text-gray-400">No departments found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {depts.map((dept) => {
                const isSelected = selectedDepts.includes(dept.id);
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => toggleDept(dept.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      isSelected
                        ? "border-primary-500 bg-primary-50 text-primary-700"
                        : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                    )}
                  >
                    {dept.name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {selectedDepts.length === 0
              ? "No scope — applies globally across all departments"
              : `Scoped to ${selectedDepts.length} department(s)`}
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            loading={submitting}
          >
            Mark as Spam
          </Button>
        </div>
      </div>
    </Modal>
  );
}
