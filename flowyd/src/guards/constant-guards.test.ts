import { describe, it, expect } from 'vitest';
import { AlwaysGuard, NeverGuard } from './constant-guards.js';
import { makeCtx } from '../../tests/helpers.js';

describe('AlwaysGuard', () => {
  it('always passes', async () => {
    expect(await new AlwaysGuard().evaluate(makeCtx())).toBe(true);
  });
});

describe('NeverGuard', () => {
  it('always blocks', async () => {
    expect(await new NeverGuard().evaluate(makeCtx())).toBe(false);
  });
});
