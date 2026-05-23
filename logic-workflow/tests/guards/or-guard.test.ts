import { describe, it, expect } from 'vitest';
import { OrGuard } from '../../src/guards/or-guard.js';
import { AlwaysGuard, NeverGuard } from '../../src/guards/primitives.js';
import { makeCtx } from '../helpers.js';

describe('OrGuard', () => {
  it('passes when at least one child passes', async () => {
    const g = new OrGuard([new NeverGuard(), new AlwaysGuard()]);
    expect(await g.evaluate(makeCtx())).toBe(true);
  });

  it('blocks when all children block', async () => {
    const g = new OrGuard([new NeverGuard(), new NeverGuard()]);
    expect(await g.evaluate(makeCtx())).toBe(false);
  });

  it('short-circuits on first success', async () => {
    let secondCalled = false;
    const second = { evaluate: async () => { secondCalled = true; return false; } };
    const g = new OrGuard([new AlwaysGuard(), second]);
    await g.evaluate(makeCtx());
    expect(secondCalled).toBe(false);
  });

  it('throws with fewer than two guards', () => {
    expect(() => new OrGuard([new AlwaysGuard()])).toThrow('at least two');
  });
});
