// src/lib/feature-flags.ts
export function isIntakePipelineV2Enabled(tenantId: string): boolean {
  const v = process.env.INTAKE_PIPELINE_V2_ENABLED ?? '';
  if (!v) return false;
  if (v.trim() === '*') return true;
  return v.split(',').map(s => s.trim()).includes(tenantId);
}
