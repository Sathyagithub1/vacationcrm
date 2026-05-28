// src/modules/intake/pipeline.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from './pipeline';
import type { IntakePayload } from './types';

describe('runPipeline', () => {
  it('runs all stages in order and short-circuits on spam block', async () => {
    const payload: IntakePayload = {
      tenantId: 't1', source: 'WEBSITE_SNIPPET',
      rawPayload: {}, sender: { phone: '+919999999999' }, webhookLogId: 'w1',
    };
    const spam = vi.fn().mockResolvedValue({ ...payload, spamCheck: { passed: false, matchedRuleId: 'r1' } });
    const normalize = vi.fn();
    const result = await runPipeline(payload, { spam, normalize } as any);
    expect(spam).toHaveBeenCalledOnce();
    expect(normalize).not.toHaveBeenCalled();
    expect(result.spamCheck?.passed).toBe(false);
  });
});
