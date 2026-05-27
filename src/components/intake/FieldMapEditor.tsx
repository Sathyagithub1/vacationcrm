"use client";

/**
 * FieldMapEditor
 *
 * Renders a paired-select interface for mapping raw webhook keys to canonical
 * CRM field names. Each row shows the raw key from the sample payload on the
 * left, and a dropdown to choose the canonical key on the right.
 *
 * Props:
 *   formId        — intake form ID (used in API calls)
 *   initialMap    — current fieldMap from GET /api/intake-forms/:id/field-map
 *   sample        — raw payload sample (key→value), used to drive left column
 *   onSaved       — callback fired after successful PATCH confirmation
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { RefreshCw } from "lucide-react";

/** Canonical CRM field options */
const CANONICAL_FIELDS = [
  { value: "",            label: "(ignore / skip)"    },
  { value: "name",        label: "name"               },
  { value: "email",       label: "email"              },
  { value: "phone",       label: "phone"              },
  { value: "source",      label: "source"             },
  { value: "message",     label: "message"            },
  { value: "destination", label: "destination"        },
  { value: "pax",         label: "pax (group size)"   },
  { value: "budget",      label: "budget"             },
  { value: "travel_date", label: "travel_date"        },
  { value: "tour_code",   label: "tour_code"          },
  { value: "channel",     label: "channel"            },
  { value: "language",    label: "language"           },
  { value: "tags",        label: "tags"               },
  { value: "custom",      label: "custom (keep raw)"  },
];

interface FieldMapEditorProps {
  formId: string;
  initialMap: Record<string, string>;
  sample: Record<string, unknown> | null;
  onSaved?: () => void;
}

export function FieldMapEditor({
  formId,
  initialMap,
  sample,
  onSaved,
}: FieldMapEditorProps) {
  const { toast } = useToast();
  const [map, setMap] = React.useState<Record<string, string>>(initialMap ?? {});
  const [saving, setSaving] = React.useState(false);
  const [rerunning, setRerunning] = React.useState(false);

  // Build raw keys list from sample or from existing map keys
  const rawKeys = React.useMemo(() => {
    const fromSample = sample ? Object.keys(sample) : [];
    const fromMap    = Object.keys(map);
    return Array.from(new Set([...fromSample, ...fromMap]));
  }, [sample, map]);

  function handleChange(rawKey: string, canonical: string) {
    setMap((prev) => ({ ...prev, [rawKey]: canonical }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/intake-forms/${formId}/field-map`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fieldMap: map }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save field map");
      }
      toast("success", "Field map saved — form is now Active");
      onSaved?.();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save field map");
    } finally {
      setSaving(false);
    }
  }

  async function handleRerunAI() {
    setRerunning(true);
    try {
      // Fetch updated field map suggestion from GET (API does AI suggestion server-side)
      const res = await fetch(`/api/intake-forms/${formId}/field-map`);
      if (!res.ok) throw new Error("Failed to fetch updated field map");
      const data = (await res.json()) as { fieldMap: Record<string, string> };
      setMap(data.fieldMap ?? {});
      toast("info", "AI suggestion applied — review and confirm");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to re-run AI suggestion");
    } finally {
      setRerunning(false);
    }
  }

  if (rawKeys.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        No sample payload received yet. Send a test webhook to populate the field map.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Map each raw webhook key to a canonical CRM field. Set to &quot;ignore&quot; to discard.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRerunAI}
          loading={rerunning}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Re-run AI suggestion
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 w-1/2">
                Raw webhook key
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 w-1/2">
                Canonical CRM field
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rawKeys.map((rawKey) => (
              <tr key={rawKey} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
                  {rawKey}
                  {sample && (
                    <span className="ml-2 text-gray-400">
                      = {String(sample[rawKey]).slice(0, 30)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Select
                    options={CANONICAL_FIELDS}
                    value={map[rawKey] ?? ""}
                    onChange={(e) => handleChange(rawKey, e.target.value)}
                    className="h-8 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving}>
          Confirm &amp; Activate
        </Button>
      </div>
    </div>
  );
}
