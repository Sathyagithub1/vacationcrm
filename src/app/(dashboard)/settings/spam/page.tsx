"use client";

/**
 * /settings/spam — Spam Rules + Log page.
 *
 * Two tabs:
 *  1. Rules — list of active spam rules + add new rule wizard
 *  2. Log   — paginated spam log with date/channel filters
 *
 * Accessible to COMPANY_ADMIN / DEPT_MANAGER.
 */

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { SpamRuleForm } from "@/components/intake/SpamRuleForm";
import { SpamLogViewer } from "@/components/intake/SpamLogViewer";
import { Plus, Trash2 } from "lucide-react";

const SPAM_TABS = [
  { label: "Rules", value: "rules" },
  { label: "Log",   value: "log"   },
];

interface SpamRule {
  id: string;
  type: string;
  identifier: string | null;
  threshold: number | null;
  windowSeconds: number | null;
  blockSeconds: number | null;
  aiThreshold: number | null;
  isActive: boolean;
  createdAt: string;
}

const RULE_TYPE_BADGE: Record<string, "danger" | "warning" | "info" | "default"> = {
  BLACKLIST:  "danger",
  RATE_LIMIT: "warning",
  PATTERN:    "info",
  AI:         "default",
};

function ruleDescription(rule: SpamRule): string {
  switch (rule.type) {
    case "BLACKLIST":
    case "PATTERN":
      return rule.identifier ?? "—";
    case "RATE_LIMIT":
      return `>${rule.threshold} msgs / ${rule.windowSeconds}s → block ${rule.blockSeconds}s`;
    case "AI":
      return `AI score > ${rule.aiThreshold}`;
    default:
      return "—";
  }
}

export default function SpamSettingsPage() {
  const { toast } = useToast();

  const [tab,       setTab]       = React.useState("rules");
  const [loading,   setLoading]   = React.useState(true);
  const [rules,     setRules]     = React.useState<SpamRule[]>([]);
  const [showNew,   setShowNew]   = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function fetchRules() {
    setLoading(true);
    try {
      const res = await fetch("/api/spam-rules?limit=100");
      if (!res.ok) throw new Error("Failed to load spam rules");
      const data: { rules: SpamRule[] } = await res.json();
      setRules(data.rules ?? []);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load spam rules");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchRules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(rule: SpamRule) {
    setDeletingId(rule.id);
    try {
      const res = await fetch(`/api/spam-rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete rule");
      }
      toast("success", "Rule deleted");
      fetchRules();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(rule: SpamRule) {
    try {
      const res = await fetch(`/api/spam-rules/${rule.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to update rule");
      }
      toast("success", rule.isActive ? "Rule paused" : "Rule activated");
      fetchRules();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to update rule");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Spam Management</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Configure spam rules to filter out junk leads before they enter your pipeline.
        </p>
      </div>

      <Tabs tabs={SPAM_TABS} activeTab={tab} onChange={setTab} />

      {/* Rules tab */}
      {tab === "rules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {!loading && `${rules.length} rule${rules.length !== 1 ? "s" : ""}`}
            </span>
            <Button size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            {loading ? (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : rules.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-gray-900">No spam rules configured</p>
                <p className="mt-1 text-xs text-gray-500">
                  Add your first rule to start filtering junk submissions.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Badge variant={RULE_TYPE_BADGE[rule.type] ?? "default"}>
                          {rule.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-600">
                        {ruleDescription(rule)}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleToggleActive(rule)}
                          className={`h-5 w-9 rounded-full transition-colors ${
                            rule.isActive ? "bg-green-500" : "bg-gray-300"
                          }`}
                          title={rule.isActive ? "Disable rule" : "Enable rule"}
                        >
                          <span
                            className={`block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform ${
                              rule.isActive ? "translate-x-4" : ""
                            }`}
                          />
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {new Date(rule.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => handleDelete(rule)}
                          disabled={deletingId === rule.id}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Delete rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {/* Log tab */}
      {tab === "log" && <SpamLogViewer />}

      {/* Add Rule Modal */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="Add Spam Rule"
      >
        <SpamRuleForm
          onCreated={() => {
            setShowNew(false);
            fetchRules();
          }}
          onCancel={() => setShowNew(false)}
        />
      </Modal>
    </div>
  );
}
