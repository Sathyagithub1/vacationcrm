"use client";

/**
 * PoolManager
 *
 * Manages assignment pools for the NAMED_POOLS strategy.
 * Shows a list of pools ordered by priority. Supports:
 *  - Add pool (name required)
 *  - Edit pool name
 *  - Delete pool (with confirmation)
 *  - Drag-to-reorder (simple up/down buttons — no native DnD library required)
 *
 * Props:
 *   pools    — current list of pools from GET /api/assignment-pools
 *   onReload — callback to re-fetch pools after a mutation
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Plus, Trash2, ChevronUp, ChevronDown, Pencil, Check, X } from "lucide-react";

export interface AssignmentPool {
  id: string;
  name: string;
  priority: number;
  agentIds: string[];
}

interface PoolManagerProps {
  pools: AssignmentPool[];
  onReload: () => void;
}

export function PoolManager({ pools, onReload }: PoolManagerProps) {
  const { toast } = useToast();

  const [newName,   setNewName]   = React.useState("");
  const [adding,    setAdding]    = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName,  setEditName]  = React.useState("");
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function handleAdd() {
    if (!newName.trim()) {
      toast("error", "Pool name is required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/assignment-pools", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName.trim(), priority: pools.length + 1 }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to create pool");
      }
      toast("success", `Pool "${newName.trim()}" created`);
      setNewName("");
      onReload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create pool");
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveEdit(pool: AssignmentPool) {
    if (!editName.trim()) {
      toast("error", "Pool name is required");
      return;
    }
    try {
      const res = await fetch(`/api/assignment-pools/${pool.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to update pool");
      }
      toast("success", "Pool renamed");
      setEditingId(null);
      onReload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to update pool");
    }
  }

  async function handleDelete(pool: AssignmentPool) {
    setDeletingId(pool.id);
    try {
      const res = await fetch(`/api/assignment-pools/${pool.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete pool");
      }
      toast("success", `Pool "${pool.name}" deleted`);
      onReload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete pool");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleMove(pool: AssignmentPool, direction: "up" | "down") {
    const sorted = [...pools].sort((a, b) => a.priority - b.priority);
    const idx    = sorted.findIndex((p) => p.id === pool.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const swapPool = sorted[swapIdx];
    try {
      await Promise.all([
        fetch(`/api/assignment-pools/${pool.id}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ priority: swapPool.priority }),
        }),
        fetch(`/api/assignment-pools/${swapPool.id}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ priority: pool.priority }),
        }),
      ]);
      onReload();
    } catch {
      toast("error", "Failed to reorder pools");
    }
  }

  const sorted = [...pools].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No pools yet. Add one below.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 divide-y divide-gray-100">
          {sorted.map((pool, idx) => (
            <div
              key={pool.id}
              className="flex items-center gap-3 bg-white px-4 py-3"
            >
              {/* Priority order buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMove(pool, "up")}
                  disabled={idx === 0}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleMove(pool, "down")}
                  disabled={idx === sorted.length - 1}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Name / edit inline */}
              {editingId === pool.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(pool);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveEdit(pool)}
                    className="rounded p-1 text-green-600 hover:bg-green-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{pool.name}</span>
                  <span className="text-xs text-gray-400">
                    {pool.agentIds?.length ?? 0} agent{(pool.agentIds?.length ?? 0) !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Actions */}
              {editingId !== pool.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(pool.id);
                      setEditName(pool.name);
                    }}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Rename pool"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(pool)}
                    disabled={deletingId === pool.id}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Delete pool"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new pool */}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="New pool name…"
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          loading={adding}
        >
          <Plus className="h-4 w-4" />
          Add Pool
        </Button>
      </div>
    </div>
  );
}
