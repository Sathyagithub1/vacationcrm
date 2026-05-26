// src/modules/intake/normalize/field-map.ts
import { getAIProvider } from "@/modules/ai/provider";

/**
 * Ask the tenant's configured AI provider to propose a field-map from raw
 * payload keys to the canonical Lead fields. Returns an object mapping
 * source key → canonical key. Keys that don't fit a canonical slot are
 * omitted. Throws on provider/JSON failure — callers (the normalize
 * orchestrator) decide whether to degrade.
 */
export async function proposeFieldMap(
  tenantId: string,
  rawPayload: Record<string, unknown>
): Promise<Record<string, string>> {
  const provider = await getAIProvider(tenantId);
  const sample = JSON.stringify(rawPayload).slice(0, 2000);
  const prompt =
    "Given a form submission payload, map each source key to one of these " +
    "canonical Lead fields: name, phone, email, language, tourCode, notes, tags. " +
    "If a key doesn't fit, omit it. Return JSON only.\n\n" +
    `Payload: ${sample}`;
  const r = await provider.completeJson(prompt);
  return (r ?? {}) as Record<string, string>;
}

/**
 * Apply a field-map to a raw payload, producing canonical fields. Source
 * keys present in the map but missing from the raw payload are skipped.
 */
export function applyFieldMap(
  raw: Record<string, unknown>,
  map: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [src, dst] of Object.entries(map)) {
    if (raw[src] !== undefined) out[dst] = raw[src];
  }
  return out;
}

/**
 * Return the list of raw-payload keys that are NOT present in the supplied
 * field-map. Used by the normalize orchestrator to raise a debounced
 * re-confirmation notification when an upstream form starts sending new
 * fields.
 */
export function detectUnknownKeys(
  raw: Record<string, unknown>,
  map: Record<string, string>
): string[] {
  return Object.keys(raw).filter((k) => !(k in map));
}
