// src/lib/feature-flags.test.ts
import { isIntakePipelineV2Enabled } from './feature-flags';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isIntakePipelineV2Enabled', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  it('returns false when unset', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', '');
    expect(isIntakePipelineV2Enabled('t1')).toBe(false);
  });
  it('returns true for any tenant when "*"', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', '*');
    expect(isIntakePipelineV2Enabled('t1')).toBe(true);
  });
  it('returns true for listed tenants only', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', 't1,t2');
    expect(isIntakePipelineV2Enabled('t1')).toBe(true);
    expect(isIntakePipelineV2Enabled('t3')).toBe(false);
  });
});
