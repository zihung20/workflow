import { describe, it, expect } from 'vitest';
import { AndGuard } from './and-guard.js';
import { AlwaysGuard, NeverGuard } from './constant-guards.js';
import { makeCtx } from '../../tests/helpers.js';

describe('AndGuard', () => {
  it('passes when all child guards pass', async () => {
    const g = new AndGuard([new AlwaysGuard(), new AlwaysGuard()]);
    expect(await g.evaluate(makeCtx())).toBe(true);
  });

  it('blocks when any child guard blocks', async () => {
    const g = new AndGuard([new AlwaysGuard(), new NeverGuard()]);
    expect(await g.evaluate(makeCtx())).toBe(false);
  });

  it('short-circuits on first failure', async () => {
    let secondCalled = false;
    const second = {
      evaluate: (): Promise<boolean> => {
        secondCalled = true;
        return Promise.resolve(true);
      },
    };
    const g = new AndGuard([new NeverGuard(), second]);
    await g.evaluate(makeCtx());
    expect(secondCalled).toBe(false);
  });

  it('throws with fewer than two guards', () => {
    expect(() => new AndGuard([new AlwaysGuard()])).toThrow('at least two');
  });
});
