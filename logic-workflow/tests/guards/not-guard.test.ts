import { describe, it, expect } from 'vitest';
import { NotGuard } from '../../src/guards/not-guard.js';
import { AlwaysGuard, NeverGuard } from '../../src/guards/primitives.js';
import { makeCtx } from '../helpers.js';

describe('NotGuard', () => {
  it('inverts a passing guard to false', async () => {
    expect(await new NotGuard(new AlwaysGuard()).evaluate(makeCtx())).toBe(false);
  });

  it('inverts a blocking guard to true', async () => {
    expect(await new NotGuard(new NeverGuard()).evaluate(makeCtx())).toBe(true);
  });
});
