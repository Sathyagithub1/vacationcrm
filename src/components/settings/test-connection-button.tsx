"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";

type Provider = "razorpay" | "smtp" | "telephony" | "stt" | "tts";

interface Props {
  provider: Provider;
  /** Disable when the section clearly has nothing saved to test. */
  disabled?: boolean;
  /** Hint shown next to the button when disabled. */
  disabledHint?: string;
}

/**
 * Runs a real connection test against the tenant's SAVED credentials for a
 * given integration and renders the live pass/fail result inline.
 * The test always exercises the stored credentials, so unsaved edits are not
 * covered — hence the "Tests saved credentials" caption.
 */
export function TestConnectionButton({ provider, disabled, disabledHint }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.ok === "boolean") {
        setResult({ ok: data.ok, message: data.message || (data.ok ? "Connected." : "Failed.") });
      } else {
        setResult({ ok: false, message: data.error || `Request failed (HTTP ${res.status}).` });
      }
    } catch {
      setResult({ ok: false, message: "Network error while running the test." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={run}
          loading={loading}
          disabled={disabled || loading}
        >
          <Plug className="h-4 w-4" />
          Test connection
        </Button>
        {disabled && disabledHint ? (
          <span className="text-xs text-gray-400">{disabledHint}</span>
        ) : (
          <span className="text-xs text-gray-400">Tests the saved credentials.</span>
        )}
      </div>

      {result && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="break-words">{result.message}</span>
        </div>
      )}
    </div>
  );
}
